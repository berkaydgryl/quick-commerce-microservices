/**
 * RedisStreamsConsumer'in kayit ve ayar kurallari (T7.4): Redis'e baglanmadan.
 * Okuma, onay ve yeniden teslim test/integration'dadir.
 */

import { AppError, EVENTS } from '@getir/core';
import type { RedisConnection } from '@getir/redis-kit';
import { describe, expect, it, vi } from 'vitest';

import { RedisStreamsConsumer } from '../../src/redis-streams-consumer.js';
import type { RedisStreamsConsumerOptions } from '../../src/redis-streams-consumer.js';
import { EVENT_HANDLED } from '../../src/subscriber.js';

const handler = () => Promise.resolve(EVENT_HANDLED);

function consumer(overrides: Partial<RedisStreamsConsumerOptions> = {}): RedisStreamsConsumer {
  return new RedisStreamsConsumer({
    connect: () => Promise.reject(new Error('bu testte Redis yok')),
    consumerName: 'host-42',
    ...overrides,
  });
}

describe('RedisStreamsConsumer: kayitlar', () => {
  it('ayni grup ayni konuyu iki kez dinleyemez', () => {
    const events = consumer();
    events.subscribe(EVENTS.PAYMENT_REFUND_REQUESTED, 'payment', handler);

    expect(() => events.subscribe(EVENTS.PAYMENT_REFUND_REQUESTED, 'payment', handler)).toThrow(
      AppError,
    );
  });

  it('farkli gruplar ayni konuyu dinleyebilir', () => {
    const events = consumer();
    events.subscribe(EVENTS.ORDER_STATUS_CHANGED, 'payment', handler);

    expect(() => events.subscribe(EVENTS.ORDER_STATUS_CHANGED, 'realtime', handler)).not.toThrow();
  });

  it.each(['', 'Payment', 'odeme servisi', '-payment'])(
    'gecersiz grup adi reddedilir: "%s"',
    (group) => {
      expect(() => consumer().subscribe(EVENTS.PAYMENT_REFUND_REQUESTED, group, handler)).toThrow(
        AppError,
      );
    },
  );

  it('durdurulduktan sonra abone eklenemez (okunmus olay atlanmis olurdu)', async () => {
    const events = consumer();
    await events.stop();

    expect(() => events.subscribe(EVENTS.PAYMENT_REFUND_REQUESTED, 'payment', handler)).toThrow(
      'Abone yalnizca dinleme baslamadan eklenir',
    );
  });
});

describe('RedisStreamsConsumer: ayarlar ve yasam dongusu', () => {
  it.each(['', 'host 42', 'x'.repeat(129)])('gecersiz tuketici adi reddedilir: "%s"', (name) => {
    expect(() => consumer({ consumerName: name })).toThrow(AppError);
  });

  it('BLOCK 0 reddedilir: Redis\'te "sonsuza dek bekle" demektir, kapanisi kilitlerdi', () => {
    expect(() => consumer({ delivery: { blockMs: 0 } })).toThrow('Gecersiz olay dinleme ayari');
  });

  it.each([{ maxDeliveries: 0 }, { claimIdleMs: 1.5 }, { batchSize: -1 }])(
    'tam sayi ve pozitif olmayan ayar reddedilir: %o',
    (delivery) => {
      expect(() => consumer({ delivery })).toThrow(AppError);
    },
  );

  it('abonesi olmayan tuketici baglanti acmaz', async () => {
    const connect = vi.fn<() => Promise<RedisConnection>>();
    const events = consumer({ connect });

    await events.start();
    await events.stop();

    expect(connect).not.toHaveBeenCalled();
  });

  it('baglanti acilamazsa start hatayi dondurur; ikinci start reddedilir', async () => {
    const events = consumer();
    events.subscribe(EVENTS.PAYMENT_REFUND_REQUESTED, 'payment', handler);

    await expect(events.start()).rejects.toThrow('bu testte Redis yok');
    await expect(events.start()).rejects.toThrow('Dinleme zaten baslatildi ya da durduruldu');
  });
});
