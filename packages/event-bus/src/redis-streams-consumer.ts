/**
 * EventConsumer'in Redis Streams uygulamasi (ADR-07, T7.4): tuketici grubu,
 * onay, yeniden teslim ve olu olaylar.
 *
 * Her grup icin AYRI baglanti acilir: XREADGROUP BLOCK beklerken baglanti
 * baska komut calistiramaz. Baglantilar bu sinifa aittir; stop kapatir.
 * Kapanista tuketici, bekleyen kaydi kalmadiysa gruptan silinir: her yeniden
 * baslatma XINFO CONSUMERS'a olu bir ad birakmasin.
 */

import { AppError, silentLogger, systemClock } from '@getir/core';
import type { Clock, EventName, Logger } from '@getir/core';
import { EVENTS_DEAD_LETTER_STREAM_KEY, EVENTS_STREAM_KEY } from '@getir/redis-kit';
import type { RedisConnection } from '@getir/redis-kit';

import { EVENTS_DEAD_LETTER_MAX_LENGTH } from './dead-letter.js';
import { DEFAULT_DELIVERY_SETTINGS } from './delivery-settings.js';
import type { DeliverySettings } from './delivery-settings.js';
import { runGroupWorker } from './group-worker.js';
import { RedisStreamGroup } from './redis-stream-group.js';
import type { EventConsumer, EventHandler } from './subscriber.js';

/** Grup adi servis adidir ("payment"): kucuk harf, rakam, tire. */
const GROUP_NAME_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
/** Tuketici adi grup icinde tekil: "<makine>-<pid>" gibi (bosluk yok). */
const CONSUMER_NAME_PATTERN = /^[\w.@-]{1,128}$/;

export interface RedisStreamsConsumerOptions {
  /** Grup basina bir baglanti acar (redis-kit connectRedis). */
  readonly connect: () => Promise<RedisConnection>;
  /** Bu surecin tuketici adi; ayni grupta calisan kopyalar arasinda tekil olmali. */
  readonly consumerName: string;
  readonly logger?: Logger;
  /** Olu olay kaydinin zamani icin; testte sabitlenir. */
  readonly clock?: Clock;
  /** Varsayilan stream:events (redis-kit). Testler ayri akis kullanir. */
  readonly streamKey?: string;
  /** Varsayilan stream:events:dead (redis-kit). */
  readonly deadLetterKey?: string;
  readonly deadLetterMaxLength?: number;
  /** Verilmeyen ayar varsayilandan gelir (delivery-settings.ts). */
  readonly delivery?: Partial<DeliverySettings>;
}

interface RunningGroup {
  readonly group: string;
  readonly connection: RedisConnection;
  readonly stream: RedisStreamGroup;
  readonly done: Promise<void>;
}

type Phase = 'registering' | 'started' | 'stopped';

export class RedisStreamsConsumer implements EventConsumer {
  private readonly routes = new Map<string, Map<string, EventHandler>>();
  private readonly running: RunningGroup[] = [];
  private readonly abort = new AbortController();
  private readonly settings: DeliverySettings;
  private readonly logger: Logger;
  private phase: Phase = 'registering';

  constructor(private readonly options: RedisStreamsConsumerOptions) {
    if (!CONSUMER_NAME_PATTERN.test(options.consumerName)) {
      throw AppError.internal('Gecersiz tuketici adi', {
        details: { consumer: options.consumerName },
      });
    }
    this.settings = validSettings({ ...DEFAULT_DELIVERY_SETTINGS, ...options.delivery });
    this.logger = (options.logger ?? silentLogger).child({
      component: 'event-consumer',
      consumer: options.consumerName,
    });
  }

  subscribe(topic: EventName, group: string, handler: EventHandler): void {
    if (this.phase !== 'registering') {
      // Okuma basladiktan sonra eklenen konunun o ana kadarki olaylari atlanmis olurdu.
      throw AppError.internal('Abone yalnizca dinleme baslamadan eklenir', {
        details: { topic, group },
      });
    }
    if (!GROUP_NAME_PATTERN.test(group)) {
      throw AppError.internal('Gecersiz tuketici grubu adi', { details: { group } });
    }
    const handlers = this.routes.get(group) ?? new Map<string, EventHandler>();
    if (handlers.has(topic)) {
      throw AppError.internal('Bu grup bu konuyu zaten dinliyor', { details: { topic, group } });
    }
    handlers.set(topic, handler);
    this.routes.set(group, handlers);
  }

  async start(): Promise<void> {
    if (this.phase !== 'registering') {
      throw AppError.internal('Dinleme zaten baslatildi ya da durduruldu');
    }
    this.phase = 'started';
    try {
      for (const [group, handlers] of this.routes) {
        this.running.push(await this.startGroup(group, handlers));
      }
    } catch (error: unknown) {
      // Acilmis gruplar ve baglantilar askida kalmasin.
      await this.stop();
      throw error;
    }
    this.logger.info(
      {
        groups: [...this.routes.keys()],
        topics: [...this.routes.values()].flatMap((handlers) => [...handlers.keys()]),
        groupStart: this.settings.groupStart,
      },
      'olay dinleme basladi',
    );
  }

  async stop(): Promise<void> {
    if (this.phase === 'stopped') {
      return;
    }
    this.phase = 'stopped';
    this.abort.abort();
    for (const running of this.running) {
      await running.done;
      await this.release(running);
      await running.connection.close();
    }
    this.running.length = 0;
  }

  private async startGroup(
    group: string,
    handlers: ReadonlyMap<string, EventHandler>,
  ): Promise<RunningGroup> {
    const connection = await this.options.connect();
    const stream = new RedisStreamGroup(connection.redis, {
      streamKey: this.options.streamKey ?? EVENTS_STREAM_KEY,
      deadLetterKey: this.options.deadLetterKey ?? EVENTS_DEAD_LETTER_STREAM_KEY,
      deadLetterMaxLength: this.options.deadLetterMaxLength ?? EVENTS_DEAD_LETTER_MAX_LENGTH,
      group,
      consumer: this.options.consumerName,
    });
    try {
      await stream.ensure(this.settings.groupStart);
    } catch (error: unknown) {
      await connection.close();
      throw error;
    }
    const logger = this.logger.child({ group });
    const done = runGroupWorker({
      group,
      stream,
      handlers,
      settings: this.settings,
      clock: this.options.clock ?? systemClock,
      logger,
      signal: this.abort.signal,
    }).catch((error: unknown) => {
      // runGroupWorker hata firlatmaz; firlatirsa bu grup artik okumuyor demektir.
      logger.error({ err: error }, 'olay dinleme dongusu beklenmedik bicimde durdu');
    });
    return { group, connection, stream, done };
  }

  /** Kapanis hatasi kapanisi durdurmaz: en kotu ihtimalle XINFO'da olu bir ad kalir. */
  private async release(running: RunningGroup): Promise<void> {
    try {
      const released = await running.stream.release();
      if (!released) {
        this.logger.info(
          { group: running.group },
          'tuketicinin bekleyen kaydi var; adi grupta birakildi (baska tuketici devralir)',
        );
      }
    } catch (error: unknown) {
      this.logger.warn({ err: error, group: running.group }, 'tuketici gruptan silinemedi');
    }
  }
}

/**
 * Ayarlar tam sayi ve pozitif olmali. Ozellikle blockMs: BLOCK 0 Redis'te
 * "sonsuza dek bekle" demektir ve kapanisi kilitlerdi.
 */
function validSettings(settings: DeliverySettings): DeliverySettings {
  const numbers = {
    batchSize: settings.batchSize,
    blockMs: settings.blockMs,
    claimIdleMs: settings.claimIdleMs,
    maxDeliveries: settings.maxDeliveries,
    retryDelayMs: settings.retryDelayMs,
  };
  const invalid = Object.entries(numbers)
    .filter(([, value]) => !Number.isInteger(value) || value < 1)
    .map(([name]) => name);
  if (invalid.length > 0) {
    throw AppError.internal('Gecersiz olay dinleme ayari', { details: { invalid } });
  }
  return settings;
}
