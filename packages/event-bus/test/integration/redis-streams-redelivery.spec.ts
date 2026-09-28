/**
 * RedisStreamsConsumer gercek Redis'te (Testcontainers, T7.4): gecici hatada
 * yeniden teslim, olu olaylar, coken tuketicinin devri ve olu olay kaydindan
 * elle yeniden oynatma (README yordami).
 */

import { EVENTS } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { DEAD_LETTER_FIELD, DEAD_LETTER_REASON } from '../../src/dead-letter.js';
import type { EventEnvelope } from '../../src/envelope.js';
import { fromStreamFields, toStreamFields } from '../../src/stream-fields.js';
import { EVENT_HANDLED, rejectEvent } from '../../src/subscriber.js';
import {
  GROUP,
  recorder,
  refundCommand,
  useRedisHarness,
  waitFor,
} from '../support/redis-harness.js';
import type { Streams } from '../support/redis-harness.js';

const redis = useRedisHarness();

describe('RedisStreamsConsumer: yeniden teslim ve olu olaylar', () => {
  it('gecici hata: onaylanmaz, takilma suresinden sonra yeniden gelir (deneme 2) ve islenir', async () => {
    const streams = redis.freshStreams();
    const attempts: number[] = [];
    const consumer = redis.consumerOn(streams);
    consumer.subscribe(EVENTS.PAYMENT_REFUND_REQUESTED, GROUP, (_envelope, delivery) => {
      attempts.push(delivery.attempt);
      return delivery.attempt === 1
        ? Promise.reject(new Error('mongo kapali'))
        : Promise.resolve(EVENT_HANDLED);
    });
    await redis.startAll(consumer);

    await redis.publish(streams, refundCommand());

    await waitFor(() => attempts.length === 2);
    expect(attempts).toEqual([1, 2]);
    await waitFor(async () => (await redis.pendingCount(streams)) === 0);
    expect(await redis.deadLetters(streams)).toEqual([]);
  });

  it('hata surerse hak bitince olu olaylara: kaynak onaylanir, orijinal alanlar korunur', async () => {
    const streams = redis.freshStreams();
    let calls = 0;
    const consumer = redis.consumerOn(streams);
    consumer.subscribe(EVENTS.PAYMENT_REFUND_REQUESTED, GROUP, () => {
      calls += 1;
      return Promise.reject(new Error('mongo kapali'));
    });
    await redis.startAll(consumer);
    const command = refundCommand();

    await redis.publish(streams, command);

    await waitFor(async () => (await redis.deadLetters(streams)).length === 1);
    const [letter] = await redis.deadLetters(streams);
    expect(letter?.get(DEAD_LETTER_FIELD.REASON)).toBe(DEAD_LETTER_REASON.EXHAUSTED);
    expect(letter?.get(DEAD_LETTER_FIELD.ATTEMPTS)).toBe('3');
    expect(letter?.get(DEAD_LETTER_FIELD.ERROR)).toBe('mongo kapali');
    expect(letter?.get(DEAD_LETTER_FIELD.GROUP)).toBe(GROUP);
    expect(letter?.get(DEAD_LETTER_FIELD.CONSUMER)).toBe('tuketici-1');
    expect(letter?.get('eventId')).toBe(command.eventId);
    expect(calls).toBe(3);
    expect(await redis.pendingCount(streams)).toBe(0);
  });

  it('reddedilen olay beklemeden olu olaylara (deneme 1)', async () => {
    const streams = redis.freshStreams();
    const consumer = redis.consumerOn(streams);
    consumer.subscribe(EVENTS.PAYMENT_REFUND_REQUESTED, GROUP, () =>
      Promise.resolve(rejectEvent('odeme bulunamadi')),
    );
    await redis.startAll(consumer);

    await redis.publish(streams, refundCommand());

    await waitFor(async () => (await redis.deadLetters(streams)).length === 1);
    const [letter] = await redis.deadLetters(streams);
    expect(letter?.get(DEAD_LETTER_FIELD.REASON)).toBe(DEAD_LETTER_REASON.REJECTED);
    expect(letter?.get(DEAD_LETTER_FIELD.ATTEMPTS)).toBe('1');
    expect(letter?.get(DEAD_LETTER_FIELD.ERROR)).toBe('odeme bulunamadi');
    expect(await redis.pendingCount(streams)).toBe(0);
  });

  it('dinlenen konuda zarfa uymayan kayit: malformed, isleyiciye gitmez', async () => {
    const streams = redis.freshStreams();
    const received: EventEnvelope[] = [];
    const consumer = redis.consumerOn(streams);
    consumer.subscribe(EVENTS.PAYMENT_REFUND_REQUESTED, GROUP, recorder(received));
    await redis.startAll(consumer);

    await redis
      .admin()
      .redis.xadd(
        streams.streamKey,
        '*',
        'eventId',
        'bozuk',
        'topic',
        EVENTS.PAYMENT_REFUND_REQUESTED,
        'payload',
        '{}',
      );

    await waitFor(async () => (await redis.deadLetters(streams)).length === 1);
    const [letter] = await redis.deadLetters(streams);
    expect(letter?.get(DEAD_LETTER_FIELD.REASON)).toBe(DEAD_LETTER_REASON.MALFORMED);
    expect(letter?.get('eventId')).toBe('bozuk');
    expect(received).toEqual([]);
  });
});

describe('RedisStreamsConsumer: coken tuketici', () => {
  /** Grubu kurar, kaydi "olu" tuketiciye teslim ettirir ve hic onaylamaz. */
  async function deliverToDeadConsumer(streams: Streams, command: EventEnvelope): Promise<string> {
    const admin = redis.admin().redis;
    await admin.xgroup('CREATE', streams.streamKey, GROUP, '0', 'MKSTREAM');
    const id = await admin.xadd(streams.streamKey, '*', ...toStreamFields(command));
    if (id === null) {
      throw new Error('kayit yazilamadi');
    }
    await admin.xreadgroup(
      'GROUP',
      GROUP,
      'olu-tuketici',
      'COUNT',
      1,
      'STREAMS',
      streams.streamKey,
      '>',
    );
    return id;
  }

  it('onaylanmamis kayit takilma suresinden sonra canli tuketiciye gecer (deneme 2)', async () => {
    const streams = redis.freshStreams();
    const command = refundCommand();
    await deliverToDeadConsumer(streams, command);
    const received: EventEnvelope[] = [];
    const attempts: number[] = [];
    const consumer = redis.consumerOn(streams, 'canli-tuketici');
    consumer.subscribe(EVENTS.PAYMENT_REFUND_REQUESTED, GROUP, recorder(received, attempts));

    await redis.startAll(consumer);

    await waitFor(() => received.length === 1);
    expect(received[0]?.eventId).toBe(command.eventId);
    expect(attempts).toEqual([2]);
    await waitFor(async () => (await redis.pendingCount(streams)) === 0);
  });

  it('hakki onceki teslimlerde bitmis kayit isleyiciye verilmeden olu olaylara', async () => {
    const streams = redis.freshStreams();
    const id = await deliverToDeadConsumer(streams, refundCommand());
    // Tuketici her teslimde cokmus gibi: teslim sayisi hakka (3) ulasir.
    await redis.admin().redis.xclaim(streams.streamKey, GROUP, 'olu-tuketici', 0, id);
    await redis.admin().redis.xclaim(streams.streamKey, GROUP, 'olu-tuketici', 0, id);
    const received: EventEnvelope[] = [];
    const consumer = redis.consumerOn(streams, 'canli-tuketici');
    consumer.subscribe(EVENTS.PAYMENT_REFUND_REQUESTED, GROUP, recorder(received));

    await redis.startAll(consumer);

    await waitFor(async () => (await redis.deadLetters(streams)).length === 1);
    const [letter] = await redis.deadLetters(streams);
    expect(letter?.get(DEAD_LETTER_FIELD.REASON)).toBe(DEAD_LETTER_REASON.EXHAUSTED);
    expect(letter?.get(DEAD_LETTER_FIELD.ATTEMPTS)).toBe('3');
    expect(letter?.get(DEAD_LETTER_FIELD.SOURCE_ID)).toBe(id);
    expect(received).toEqual([]);
  });
});

describe('RedisStreamsConsumer: olu olay kaydindan yeniden oynatma', () => {
  it('dead. alanlari atilip akisa geri yazilan kayit yeniden teslim edilir (README yordami)', async () => {
    const streams = redis.freshStreams();
    const seen = new Set<string>();
    const handled: string[] = [];
    const consumer = redis.consumerOn(streams);
    // Ilk teslimde reddeder (ornek: hedef kayit henuz yok), ikincisinde isler.
    consumer.subscribe(EVENTS.PAYMENT_REFUND_REQUESTED, GROUP, (envelope) => {
      if (!seen.has(envelope.eventId)) {
        seen.add(envelope.eventId);
        return Promise.resolve(rejectEvent('hedef kayit henuz yok'));
      }
      handled.push(envelope.eventId);
      return Promise.resolve(EVENT_HANDLED);
    });
    await redis.startAll(consumer);
    const command = refundCommand();
    await redis.publish(streams, command);
    await waitFor(async () => (await redis.deadLetters(streams)).length === 1);

    const [entry] = await redis.admin().redis.xrange(streams.deadLetterKey, '-', '+');
    const fields = entry?.[1] ?? [];
    const original: string[] = [];
    for (let index = 0; index + 1 < fields.length; index += 2) {
      const name = fields[index] ?? '';
      if (!name.startsWith('dead.')) {
        original.push(name, fields[index + 1] ?? '');
      }
    }
    expect(fromStreamFields(original)).toEqual(command);
    await redis.admin().redis.xadd(streams.streamKey, '*', ...original);

    await waitFor(() => handled.length === 1);
    expect(handled).toEqual([command.eventId]);
  });
});
