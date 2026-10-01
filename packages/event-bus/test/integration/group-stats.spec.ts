/**
 * Grup istatistigi ve tuketici metrikleri gercek Redis'te (T10.5, #12): XINFO
 * GROUPS cevabinin bicimi (Redis 7 + ioredis) ve tuketicinin metrige yazdigi
 * gecikme, bekleyen ve sonuc sayaci.
 */

import { EVENTS } from '@getir/core';
import { metricsRegistry } from '@getir/observability';
import { metricValue } from '@getir/observability/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { CONSUMER_METRICS } from '../../src/consumer-metrics.js';
import { GROUP_START } from '../../src/delivery-settings.js';
import type { EventEnvelope } from '../../src/envelope.js';
import { RedisStreamGroup } from '../../src/redis-stream-group.js';
import type { Streams } from '../support/redis-harness.js';
import {
  GROUP,
  recorder,
  refundCommand,
  useRedisHarness,
  waitFor,
} from '../support/redis-harness.js';

const redis = useRedisHarness();

beforeEach(() => {
  metricsRegistry.resetMetrics();
});

function groupOn(streams: Streams, group = GROUP): RedisStreamGroup {
  return new RedisStreamGroup(redis.admin().redis, {
    ...streams,
    deadLetterMaxLength: 100,
    group,
    consumer: 'inceleme',
  });
}

describe('RedisStreamGroup.stats (XINFO GROUPS)', () => {
  it('lag teslim edilmemisi, pending onaylanmamisi sayar', async () => {
    const streams = redis.freshStreams();
    const group = groupOn(streams);
    await group.ensure(GROUP_START.BEGINNING);
    expect(await group.stats()).toEqual({ lag: 0, pending: 0 });

    for (let index = 0; index < 3; index += 1) {
      await redis.publish(streams, refundCommand());
    }
    expect(await group.stats()).toEqual({ lag: 3, pending: 0 });

    const read = await group.readNew(2, 10);
    expect(await group.stats()).toEqual({ lag: 1, pending: 2 });

    await group.ack([read[0]?.id ?? '']);
    expect(await group.stats()).toEqual({ lag: 1, pending: 1 });
  });

  it('grup yoksa undefined; ayni akistaki baska grubu karistirmaz', async () => {
    const streams = redis.freshStreams();
    await groupOn(streams, 'risk').ensure(GROUP_START.BEGINNING);
    await redis.publish(streams, refundCommand());

    expect(await groupOn(streams, GROUP).stats()).toBeUndefined();
    expect(await groupOn(streams, 'risk').stats()).toEqual({ lag: 1, pending: 0 });
  });
});

describe('RedisStreamsConsumer: metrikler', () => {
  it('islenen olayi sayar; tur sonunda gecikme ve bekleyen sifir yazilir', async () => {
    const streams = redis.freshStreams();
    // Dinleme baslamadan birakilan iki komut: ilk tur ikisini birden isler.
    await redis.publish(streams, refundCommand());
    await redis.publish(streams, refundCommand());
    const received: EventEnvelope[] = [];
    const consumer = redis.consumerOn(streams);
    consumer.subscribe(EVENTS.PAYMENT_REFUND_REQUESTED, GROUP, recorder(received));

    await redis.startAll(consumer);

    await waitFor(() => received.length === 2);
    const handled = { group: GROUP, topic: EVENTS.PAYMENT_REFUND_REQUESTED, outcome: 'handled' };
    await waitFor(async () => (await metricValue(CONSUMER_METRICS.EVENTS, handled)) === 2);
    await waitFor(
      async () => (await metricValue(CONSUMER_METRICS.PENDING, { group: GROUP })) === 0,
    );
    expect(await metricValue(CONSUMER_METRICS.LAG, { group: GROUP })).toBe(0);
  });
});
