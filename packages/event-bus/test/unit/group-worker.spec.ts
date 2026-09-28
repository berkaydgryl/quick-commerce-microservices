/**
 * Grup dongusu (T7.4) sahte akisla: hangi kayit ne zaman onaylanir, takilan
 * kayit nasil devralinir, tur hatasi ve kapanis. Redis komutlarinin gercegi
 * test/integration'dadir.
 */

import { EVENTS, fixedClock } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEAD_LETTER_REASON } from '../../src/dead-letter.js';
import { GROUP_START } from '../../src/delivery-settings.js';
import type { DeliverySettings } from '../../src/delivery-settings.js';
import type { StreamEntry } from '../../src/dispatch.js';
import { runGroupWorker } from '../../src/group-worker.js';
import type { DeadLetterDetails, PendingEntry, StreamGroup } from '../../src/redis-stream-group.js';
import { EVENT_HANDLED } from '../../src/subscriber.js';
import type { EventHandler } from '../../src/subscriber.js';
import { entryOf, envelopeOf } from '../support/envelopes.js';

const NOW_MS = 1_790_000_000_000;
const settings: DeliverySettings = {
  groupStart: GROUP_START.BEGINNING,
  batchSize: 10,
  blockMs: 5,
  claimIdleMs: 1_000,
  maxDeliveries: 3,
  retryDelayMs: 1,
};

/**
 * Senaryoyu sirayla oynatan akis: readNew once hatalari, sonra partileri
 * dondurur; partiler bitince donguyu durdurur (onDrained).
 */
class ScriptedStreamGroup implements StreamGroup {
  readonly ackCalls: string[][] = [];
  readonly deadLetters: { readonly id: string; readonly details: DeadLetterDetails }[] = [];
  readonly claimed: string[] = [];
  readonly failures: Error[] = [];
  readonly batches: StreamEntry[][] = [];
  readonly stale: PendingEntry[][] = [];
  readonly claimable = new Map<string, StreamEntry>();
  ensureCalls = 0;
  readCalls = 0;

  constructor(private readonly onDrained: () => void) {}

  ensure(): Promise<void> {
    this.ensureCalls += 1;
    return Promise.resolve();
  }

  stalePending(): Promise<PendingEntry[]> {
    return Promise.resolve(this.stale.shift() ?? []);
  }

  claim(id: string): Promise<StreamEntry | undefined> {
    this.claimed.push(id);
    return Promise.resolve(this.claimable.get(id));
  }

  readNew(): Promise<StreamEntry[]> {
    this.readCalls += 1;
    const failure = this.failures.shift();
    if (failure !== undefined) {
      return Promise.reject(failure);
    }
    const batch = this.batches.shift();
    if (batch === undefined) {
      this.onDrained();
      return Promise.resolve([]);
    }
    return Promise.resolve(batch);
  }

  ack(ids: readonly string[]): Promise<void> {
    if (ids.length > 0) {
      this.ackCalls.push([...ids]);
    }
    return Promise.resolve();
  }

  deadLetter(entry: StreamEntry, details: DeadLetterDetails): Promise<void> {
    this.deadLetters.push({ id: entry.id, details });
    return Promise.resolve();
  }

  release(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

let controller: AbortController;
let stream: ScriptedStreamGroup;
let lines: LogLine[];

beforeEach(() => {
  controller = new AbortController();
  stream = new ScriptedStreamGroup(() => controller.abort());
  lines = [];
});

/** Iade komutu isleyicisi: orderId "ord_hata" ise gecici hata firlatir. */
const refundHandler: EventHandler = (envelope) =>
  envelope.payload['orderId'] === 'ord_hata'
    ? Promise.reject(new Error('mongo kapali'))
    : Promise.resolve(EVENT_HANDLED);

function run(handler: EventHandler = refundHandler): Promise<void> {
  return runGroupWorker({
    stream,
    handlers: new Map([[EVENTS.PAYMENT_REFUND_REQUESTED, handler]]),
    settings,
    clock: fixedClock(NOW_MS),
    logger: recordingLogger(lines, { group: 'payment' }),
    signal: controller.signal,
  });
}

const refund = (id: string, orderId = 'ord_1') =>
  entryOf(id, envelopeOf(EVENTS.PAYMENT_REFUND_REQUESTED, { orderId }));
const other = (id: string) => entryOf(id, envelopeOf(EVENTS.ORDER_CREATED));

describe('runGroupWorker: yeni okunan parti', () => {
  it('islenen hemen, grubun olmayan konular turun sonunda TEK XACK ile onaylanir', async () => {
    stream.batches.push([refund('1-0'), other('2-0'), other('3-0')]);

    await run();

    expect(stream.ackCalls).toEqual([['1-0'], ['2-0', '3-0']]);
  });

  it('gecici hata onaylanmaz: WARN yazilir, kayit takilma suresinden sonra yeniden gelir', async () => {
    stream.batches.push([refund('1-0', 'ord_hata')]);

    await run();

    expect(stream.ackCalls).toEqual([]);
    expect(lines.find((line) => line.level === 'warn')).toMatchObject({
      fields: { streamId: '1-0', topic: EVENTS.PAYMENT_REFUND_REQUESTED, attempt: 1 },
      message: 'olay islenemedi; takilma suresinden sonra yeniden teslim edilecek',
    });
  });
});

describe('runGroupWorker: takilan kayitlar', () => {
  it('tek tek devralinir; deneme = onceki teslim + 1', async () => {
    const attempts: number[] = [];
    stream.stale.push([{ id: '5-0', deliveries: 2 }]);
    stream.claimable.set('5-0', refund('5-0'));

    await run((_envelope, delivery) => {
      attempts.push(delivery.attempt);
      return Promise.resolve(EVENT_HANDLED);
    });

    expect(stream.claimed).toEqual(['5-0']);
    expect(attempts).toEqual([3]);
    expect(stream.ackCalls).toEqual([['5-0']]);
  });

  it('hakki bitmis kayit isleyiciye verilmeden olu olaylara; zaman damgasi saatten', async () => {
    stream.stale.push([{ id: '6-0', deliveries: settings.maxDeliveries }]);
    stream.claimable.set('6-0', refund('6-0'));
    const handler = vi.fn<EventHandler>(() => Promise.resolve(EVENT_HANDLED));

    await run(handler);

    expect(handler).not.toHaveBeenCalled();
    expect(stream.deadLetters).toEqual([
      {
        id: '6-0',
        details: {
          reason: DEAD_LETTER_REASON.EXHAUSTED,
          attempts: settings.maxDeliveries,
          error: 'deneme hakki onceki teslimlerde bitti; isleyiciye verilmedi',
          at: new Date(NOW_MS),
        },
      },
    ]);
    expect(lines.find((line) => line.level === 'error')).toMatchObject({
      fields: { group: 'payment', streamId: '6-0', reason: DEAD_LETTER_REASON.EXHAUSTED },
      message: 'olay islenemedi; olu olaylar akisina tasindi',
    });
  });

  it('grubun olmayan takilan kayit onaylanip gecilir (hakki bitmis olsa da olu sayilmaz)', async () => {
    stream.stale.push([{ id: '7-0', deliveries: 9 }]);
    stream.claimable.set('7-0', other('7-0'));

    await run();

    expect(stream.ackCalls).toEqual([['7-0']]);
    expect(stream.deadLetters).toEqual([]);
  });

  it('baska tuketicinin az once aldigi kayit atlanir', async () => {
    stream.stale.push([{ id: '8-0', deliveries: 1 }]);
    const handler = vi.fn<EventHandler>(() => Promise.resolve(EVENT_HANDLED));

    await run(handler);

    expect(stream.claimed).toEqual(['8-0']);
    expect(handler).not.toHaveBeenCalled();
    expect(stream.ackCalls).toEqual([]);
  });
});

describe('runGroupWorker: hata ve kapanis', () => {
  it('tur hatasi dongu durdurmaz: WARN, kisa bekleme, sonraki tur isler', async () => {
    stream.failures.push(new Error('baglanti koptu'));
    stream.batches.push([refund('1-0')]);

    await run();

    expect(
      lines.some((line) => line.message === 'olay okuma turu basarisiz; beklenip denenecek'),
    ).toBe(true);
    expect(stream.ackCalls).toEqual([['1-0']]);
  });

  it('grup silinmisse (NOGROUP) yeniden kurulur ve okuma surer', async () => {
    stream.failures.push(new Error("NOGROUP No such key 'stream:events' or consumer group"));
    stream.batches.push([refund('1-0')]);

    await run();

    expect(stream.ensureCalls).toBe(1);
    expect(stream.ackCalls).toEqual([['1-0']]);
  });

  it('kapanista eldeki parti bitirilir, yeni okuma yapilmaz', async () => {
    stream.batches.push([refund('1-0'), refund('2-0')], [refund('3-0')]);
    const handler: EventHandler = () => {
      controller.abort();
      return Promise.resolve(EVENT_HANDLED);
    };

    await run(handler);

    expect(stream.ackCalls).toEqual([['1-0'], ['2-0']]);
    expect(stream.readCalls).toBe(1);
  });
});
