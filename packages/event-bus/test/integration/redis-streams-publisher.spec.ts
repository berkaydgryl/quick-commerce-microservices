/**
 * RedisStreamsPublisher gercek Redis'te (Testcontainers): XADD'in yazdigi kayit
 * XRANGE ile okunur ve zarfa birebir doner; bozuk zarf hatta hic girmez.
 */

import { AppError, EVENTS, ID_PREFIX, newId } from '@getir/core';
import { connectRedis } from '@getir/redis-kit';
import type { RedisConnection } from '@getir/redis-kit';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { EventEnvelope } from '../../src/envelope.js';
import { RedisStreamsPublisher } from '../../src/redis-streams-publisher.js';
import { fromStreamFields } from '../../src/stream-fields.js';

/** infra/docker/docker-compose.dev.yml ile ayni surum. */
const REDIS_IMAGE = 'redis:7-alpine';
const STREAM = 'stream:events';

let container: StartedRedisContainer;
let connection: RedisConnection;

beforeAll(async () => {
  container = await new RedisContainer(REDIS_IMAGE).start();
  connection = await connectRedis({ url: container.getConnectionUrl(), name: 'event-bus-test' });
});

afterAll(async () => {
  await connection?.close();
  await container?.stop();
});

const envelope = (topic: EventEnvelope['topic'], orderId: string): EventEnvelope => ({
  eventId: newId(ID_PREFIX.EVENT),
  topic,
  partitionKey: orderId,
  occurredAt: new Date().toISOString(),
  payload: { orderId },
});

async function readStream(): Promise<EventEnvelope[]> {
  const entries = await connection.redis.xrange(STREAM, '-', '+');
  return entries.map(([, fields]) => fromStreamFields(fields));
}

describe('RedisStreamsPublisher', () => {
  it('stream:events e yazar; kayitlar yayin sirasiyla ve zarf birebir okunur', async () => {
    const publisher = new RedisStreamsPublisher(connection.redis);
    const first = envelope(EVENTS.ORDER_CREATED, 'ord_1');
    const second = envelope(EVENTS.ORDER_STATUS_CHANGED, 'ord_1');

    await publisher.publish(first);
    await publisher.publish(second);

    expect(await readStream()).toEqual([first, second]);
  });

  it('bozuk zarf hatta girmez: INTERNAL, akis degismez', async () => {
    const publisher = new RedisStreamsPublisher(connection.redis);
    const before = await connection.redis.xlen(STREAM);

    await expect(
      // Tip sistemi bozuk kimligi zaten reddeder; calisma aninda da reddedildigi sinanir.
      publisher.publish({
        ...envelope(EVENTS.ORDER_CREATED, 'ord_2'),
        eventId: 'bozuk' as EventEnvelope['eventId'],
      }),
    ).rejects.toBeInstanceOf(AppError);
    expect(await connection.redis.xlen(STREAM)).toBe(before);
  });

  it('akis uzunlugu sinirlidir (MAXLEN ~): sinirin cok ustune cikmaz', async () => {
    const stream = 'stream:test-kirpma';
    const publisher = new RedisStreamsPublisher(connection.redis, {
      streamKey: stream,
      maxLength: 100,
    });

    for (let index = 0; index < 500; index += 1) {
      await publisher.publish(envelope(EVENTS.ORDER_CREATED, `ord_${index}`));
    }

    // Yaklasik kirpma dugum boyunda keser: tam 100 degil ama 500'e de cikmaz.
    expect(await connection.redis.xlen(stream)).toBeLessThan(500);
  });
});
