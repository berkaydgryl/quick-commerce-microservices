/**
 * Socket.io Redis adapter'i (T12.1, K3): birden cok realtime kopyasi ayni odalari
 * paylasir. Bir kopyada yapilan yayin Redis pub/sub ile digerlerine gider ve her
 * kopya kendi soketlerine dagitir (ADR-06).
 *
 * Iki baglanti gerekir: abone moduna gecen baglanti baska komut calistiramaz,
 * bu yuzden yayin (pub) ve abonelik (sub) ayridir. Ikisi de @getir/redis-kit'in
 * tek kurulum noktasindan gelir (yeniden deneme, zaman asimi, hata dinleyicisi).
 *
 * ANAHTAR YAZILMAZ: adapter yalnizca kanal kullanir (pub/sub); Redis'te kalici
 * veri birakmaz, TTL kurali bu yuzden konu disidir.
 *
 * SONUCU BEKLENMEYEN KOMUTLAR: adapter (8.3.0) `publish` ve abonelik
 * komutlarini cagirir ama dondukleri sozu beklemez. Redis kapaliyken ioredis bu
 * komutlari kuyrukta tutar, deneme hakki bitince (maxRetriesPerRequest) sozu
 * reddeder; red kimsenin yakalamadigi bir hata olur ve surec kapanir
 * (installProcessHandlers: unhandledRejection). Kisa bir Redis kesintisinde
 * butun canli baglantilarin kopmasi demekti (entegrasyon testi yakaladi).
 * Kutuphane degistirilmez; adapter'a verilen BAGLANTI sarilir: bu komutlarin
 * reddi uyari olarak gunluge yazilir. Ayni soz cagirana da doner; bekleyen varsa
 * hatayi o da alir.
 */

import type { Logger } from '@getir/core';
import { connectRedis } from '@getir/redis-kit';
import type { RedisConnection, RedisEnv } from '@getir/redis-kit';
import { createAdapter } from '@socket.io/redis-adapter';

import { ADAPTER_CHANNEL_PREFIX, REDIS_CONNECTION_NAME } from '../config/constants.js';

/** Adapter'in sonucunu beklemeden cagirdigi komutlar (8.3.0, ioredis yolu). */
const UNAWAITED_COMMANDS: ReadonlySet<string> = new Set([
  'publish',
  'psubscribe',
  'punsubscribe',
  'subscribe',
  'unsubscribe',
]);

/** Socket.io'nun `adapter` secenegine verilen fabrika. */
export type AdapterFactory = ReturnType<typeof createAdapter>;

export interface RedisAdapterHandle {
  readonly adapter: AdapterFactory;
  /** Iki baglanti da hazir mi? Saglik ucu (D7) bunu sorar; I/O yapmaz. */
  isReady(): boolean;
  /** Iki baglantiyi kapatir; hata firlatmaz. */
  close(): Promise<void>;
}

export interface RedisAdapterOptions {
  readonly redis: RedisEnv;
  readonly logger: Logger;
}

/** Iki baglantiyi acar ve adapter'i kurar; baglanti kurulamazsa AppError firlatir. */
export async function openRedisAdapter(options: RedisAdapterOptions): Promise<RedisAdapterHandle> {
  const connect = (name: string): Promise<RedisConnection> =>
    connectRedis({
      url: options.redis.REDIS_URL,
      connectTimeoutMs: options.redis.REDIS_CONNECT_TIMEOUT_MS,
      logger: options.logger,
      name,
    });

  const pub = await connect(REDIS_CONNECTION_NAME.PUB);
  let sub: RedisConnection;
  try {
    sub = await connect(REDIS_CONNECTION_NAME.SUB);
  } catch (error: unknown) {
    // Ikincisi acilamadiysa ilki askida kalmasin.
    await pub.close();
    throw error;
  }

  return {
    adapter: createAdapter(
      catchUnawaited(pub, REDIS_CONNECTION_NAME.PUB, options.logger),
      catchUnawaited(sub, REDIS_CONNECTION_NAME.SUB, options.logger),
      { key: ADAPTER_CHANNEL_PREFIX },
    ),
    isReady: () => pub.redis.status === 'ready' && sub.redis.status === 'ready',
    close: async () => {
      await Promise.all([pub.close(), sub.close()]);
    },
  };
}

/**
 * Baglantiyi, sonucu beklenmeyen komutlarin reddini gunluge yazan bir vekille
 * sarar (dosya basi). Diger her ozellik ve komut oldugu gibi gecer.
 */
function catchUnawaited(
  connection: RedisConnection,
  name: string,
  logger: Logger,
): RedisConnection['redis'] {
  return new Proxy(connection.redis, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (
        typeof property !== 'string' ||
        !UNAWAITED_COMMANDS.has(property) ||
        typeof value !== 'function'
      ) {
        return value;
      }
      const command = value as (...args: unknown[]) => unknown;
      return (...args: unknown[]): unknown => {
        const result = command.apply(target, args);
        if (result instanceof Promise) {
          result.catch((error: unknown) => {
            logger.warn(
              { err: error, command: property, connection: name },
              'redis adapter komutu basarisiz',
            );
          });
        }
        return result;
      };
    },
  });
}
