/**
 * RedisStreamsConsumer gercek Redis'te (Testcontainers, T7.4): teslim ve onay,
 * gruplar, kapanis ve Redis verisinin silinmesi. Yeniden teslim ve olu olaylar
 * redis-streams-redelivery.spec.ts'te.
 */

import { setTimeout as delay } from 'node:timers/promises';

import { EVENTS } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { GROUP_START } from '../../src/delivery-settings.js';
import type { EventEnvelope } from '../../src/envelope.js';
import { EVENT_HANDLED } from '../../src/subscriber.js';
import {
  FAST_DELIVERY,
  GROUP,
  orderCreated,
  recorder,
  refundCommand,
  useRedisHarness,
  waitFor,
} from '../support/redis-harness.js';

const redis = useRedisHarness();

describe('RedisStreamsConsumer: teslim ve onay', () => {
  it('yayinlanan olay isleyiciye gelir ve onaylanir (bekleyen kalmaz)', async () => {
    const streams = redis.freshStreams();
    const received: EventEnvelope[] = [];
    const consumer = redis.consumerOn(streams);
    consumer.subscribe(EVENTS.PAYMENT_REFUND_REQUESTED, GROUP, recorder(received));
    await redis.startAll(consumer);
    const command = refundCommand();

    await redis.publish(streams, command);

    await waitFor(() => received.length === 1);
    expect(received).toEqual([command]);
    await waitFor(async () => (await redis.pendingCount(streams)) === 0);
  });

  it('grup ilk kez akisin basindan okur: dinleme baslamadan birakilan komut kaybolmaz', async () => {
    const streams = redis.freshStreams();
    const before = refundCommand();
    await redis.publish(streams, before);
    const received: EventEnvelope[] = [];
    const consumer = redis.consumerOn(streams);
    consumer.subscribe(EVENTS.PAYMENT_REFUND_REQUESTED, GROUP, recorder(received));

    await redis.startAll(consumer);

    await waitFor(() => received.length === 1);
    expect(received[0]?.eventId).toBe(before.eventId);
  });

  it('"latest" ile kurulan grup yalnizca sonrakileri alir', async () => {
    const streams = redis.freshStreams();
    await redis.publish(streams, refundCommand());
    const received: EventEnvelope[] = [];
    const consumer = redis.consumerOn(streams, 'tuketici-1', {
      ...FAST_DELIVERY,
      groupStart: GROUP_START.LATEST,
    });
    consumer.subscribe(EVENTS.PAYMENT_REFUND_REQUESTED, 'realtime', recorder(received));
    await redis.startAll(consumer);
    const after = refundCommand();

    await redis.publish(streams, after);

    await waitFor(() => received.length === 1);
    await delay(200);
    expect(received.map((envelope) => envelope.eventId)).toEqual([after.eventId]);
  });

  it('farkli gruplar her olayi ayri ayri alir; ayni gruptaki iki tuketici isi paylasir (her olay bir kez)', async () => {
    const streams = redis.freshStreams();
    const paymentSeen: EventEnvelope[] = [];
    const realtimeSeen: EventEnvelope[] = [];
    const first = redis.consumerOn(streams, 'odeme-1');
    const second = redis.consumerOn(streams, 'odeme-2');
    const realtime = redis.consumerOn(streams, 'canli-1');
    first.subscribe(EVENTS.PAYMENT_REFUND_REQUESTED, GROUP, recorder(paymentSeen));
    second.subscribe(EVENTS.PAYMENT_REFUND_REQUESTED, GROUP, recorder(paymentSeen));
    realtime.subscribe(EVENTS.PAYMENT_REFUND_REQUESTED, 'realtime', recorder(realtimeSeen));
    await redis.startAll(first, second, realtime);
    const commands = Array.from({ length: 20 }, () => refundCommand());

    for (const command of commands) {
      await redis.publish(streams, command);
    }

    await waitFor(() => paymentSeen.length >= 20 && realtimeSeen.length >= 20);
    await delay(200);
    const ids = commands.map((command) => command.eventId).sort();
    expect(paymentSeen.map((envelope) => envelope.eventId).sort()).toEqual(ids);
    expect(realtimeSeen.map((envelope) => envelope.eventId).sort()).toEqual(ids);
  });

  it('grubun dinlemedigi konu isleyiciye gitmez ama onaylanir', async () => {
    const streams = redis.freshStreams();
    const received: EventEnvelope[] = [];
    const consumer = redis.consumerOn(streams);
    consumer.subscribe(EVENTS.PAYMENT_REFUND_REQUESTED, GROUP, recorder(received));
    await redis.startAll(consumer);
    const command = refundCommand();

    await redis.publish(streams, orderCreated());
    await redis.publish(streams, command);

    await waitFor(() => received.length === 1);
    expect(received[0]?.eventId).toBe(command.eventId);
    await waitFor(async () => (await redis.pendingCount(streams)) === 0);
  });
});

describe('RedisStreamsConsumer: kapanis ve Redis verisi', () => {
  it('stop suren isleyiciyi bekler, tuketiciyi gruptan siler; sonra olay islenmez', async () => {
    const streams = redis.freshStreams();
    let handlerStarted = false;
    let finishHandler: () => void = () => undefined;
    const handlerDone = new Promise<void>((resolve) => {
      finishHandler = resolve;
    });
    let calls = 0;
    const consumer = redis.consumerOn(streams);
    consumer.subscribe(EVENTS.PAYMENT_REFUND_REQUESTED, GROUP, async () => {
      calls += 1;
      handlerStarted = true;
      await handlerDone;
      return EVENT_HANDLED;
    });
    await redis.startAll(consumer);
    await redis.publish(streams, refundCommand());
    await waitFor(() => handlerStarted);

    let stopped = false;
    const stopping = consumer.stop().then(() => {
      stopped = true;
    });
    await delay(150);
    expect(stopped).toBe(false);
    finishHandler();
    await stopping;

    expect(await redis.pendingCount(streams)).toBe(0);
    const consumers = await redis.admin().redis.xinfo('CONSUMERS', streams.streamKey, GROUP);
    expect(JSON.stringify(consumers)).not.toContain('tuketici-1');
    await redis.publish(streams, refundCommand());
    await delay(200);
    expect(calls).toBe(1);
  });

  it('akis silinirse (Redis verisi gitti) grup yeniden kurulur ve okuma surer', async () => {
    const streams = redis.freshStreams();
    const received: EventEnvelope[] = [];
    const consumer = redis.consumerOn(streams);
    consumer.subscribe(EVENTS.PAYMENT_REFUND_REQUESTED, GROUP, recorder(received));
    await redis.startAll(consumer);
    await redis.publish(streams, refundCommand());
    await waitFor(() => received.length === 1);

    await redis.admin().redis.del(streams.streamKey);
    const after = refundCommand();
    await redis.publish(streams, after);

    await waitFor(() => received.length === 2);
    expect(received[1]?.eventId).toBe(after.eventId);
  });
});
