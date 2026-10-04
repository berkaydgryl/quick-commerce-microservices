/**
 * QA kara kutu (T12.3): order.status_changed -> order.status, URETIM teslim
 * ayarlariyla (blockMs 2000, claimIdleMs 30 sn; override yok) ve tek kopyada.
 *
 * Olaylar event-bus'in gercek yayincisiyla stream:events'e yazilir, istemci
 * gercek socket.io-client'tir. Backend'in uctan uca testi kisaltilmis teslim
 * ayarlariyla (blockMs 200) kosar; buradaki gecikme olcumu uretim degerleriyle.
 * Beklentiler docs/api/socket-events.md "order.status teslimi" ve T12.3 raporundan.
 */

import { setTimeout as delay } from 'node:timers/promises';

import { EVENTS, ID_PREFIX, newId } from '@getir/core';
import { EVENTS_DEAD_LETTER_STREAM_KEY, EVENTS_STREAM_KEY, realtimeSeqKey } from '@getir/redis-kit';
import type { Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { RealtimeServer } from '../../src/bootstrap.js';
import { EVENT_CONSUMER_GROUP, SEQ_TTL_MS } from '../../src/config/constants.js';
import { collectEvents } from '../support/clients.js';
import {
  deadLetters,
  DELIVERY_TARGET_MS,
  MARKET_ID,
  newOrderId,
  orderClient,
  pendingCount,
  recordArrivals,
  seqsOf,
  startQaNode,
  startQaRedis,
  statusEnvelope,
  transition,
} from '../support/qa-event-harness.js';
import type { Arrival, QaRedis } from '../support/qa-event-harness.js';
import { USER_ID } from '../support/tokens.js';

/** XREADGROUP BLOCK'un (2000 ms) bos donecegi kadar bekleme: tuketici bosta dolanir. */
const IDLE_GAP_MS = 2_500;
const BURSTS = 4;
const EVENTS_PER_BURST = 5;

describe('QA T12.3: teslim, uretim ayarlari, tek kopya', () => {
  let redis: QaRedis;
  let node: RealtimeServer;
  const sockets: Socket[] = [];

  async function client(orderId: string): Promise<{ socket: Socket; arrivals: Arrival[] }> {
    const socket = await orderClient(node.port, orderId);
    sockets.push(socket);
    return { socket, arrivals: recordArrivals(socket) };
  }

  /** Tek olayi yazar ve istemciye varisini bekler; gecikmeyi (ms) doner. */
  async function publishAndAwait(
    arrivals: Arrival[],
    change: Parameters<typeof statusEnvelope>[0],
  ) {
    const sentAt = Date.now();
    await redis.publisher.publish(statusEnvelope(change));
    await expect
      .poll(() => arrivals.find((arrival) => arrival.payload['seq'] === change.version), {
        timeout: 3 * DELIVERY_TARGET_MS,
        interval: 10,
      })
      .toBeDefined();
    const arrival = arrivals.find((candidate) => candidate.payload['seq'] === change.version);
    return (arrival?.at ?? Number.POSITIVE_INFINITY) - sentAt;
  }

  beforeAll(async () => {
    redis = await startQaRedis();
    // Teslim ayari VERILMEZ: main.ts'in kurdugu gibi event-bus varsayilanlari + LATEST.
    node = await startQaNode(redis.url, { name: 'qa-tek-kopya' });
  });

  afterAll(async () => {
    for (const socket of sockets) {
      socket.close();
    }
    await node?.shutdown('qa testi bitti');
    await redis?.stop();
  });

  it('QA-RT3-01: bosta beklemelerden sonra da her gecis 1 sn icinde istemcide (20 olcum)', async () => {
    const orderId = newOrderId();
    const { arrivals } = await client(orderId);
    const latencies: number[] = [];
    let version = 1;

    for (let burst = 0; burst < BURSTS; burst += 1) {
      await delay(IDLE_GAP_MS);
      for (let index = 0; index < EVENTS_PER_BURST; index += 1) {
        version += 1;
        latencies.push(await publishAndAwait(arrivals, transition(orderId, version)));
      }
    }

    const sorted = [...latencies].sort((left, right) => left - right);
    console.info(
      `QA-RT3-01 gecikme (ms): p50 ${sorted[Math.floor(sorted.length / 2)]}, en kotu ${sorted.at(-1)}, en iyi ${sorted[0]}`,
    );
    expect(latencies).toHaveLength(BURSTS * EVENTS_PER_BURST);
    expect(Math.max(...latencies)).toBeLessThan(DELIVERY_TARGET_MS);
    expect(seqsOf(arrivals)).toEqual(Array.from({ length: version - 1 }, (_, index) => index + 2));
  }, 60_000);

  it('QA-RT3-03: sokete yalnizca orderId, status, previousStatus, at, seq cikar; ic alanlar cikmaz', async () => {
    const orderId = newOrderId();
    const { arrivals } = await client(orderId);
    const internalNote = 'qa-ic-iptal-notu';

    // Ilk gecis: from yok.
    await publishAndAwait(arrivals, {
      orderId,
      version: 2,
      to: 'RISK_CHECK',
      extra: { note: internalNote, amountMinor: 4_599 },
    });
    await publishAndAwait(arrivals, {
      orderId,
      version: 3,
      from: 'RISK_CHECK',
      to: 'RESERVED',
      extra: { note: internalNote, courierPhone: '+905551112233' },
    });

    expect(Object.keys(arrivals[0]?.payload ?? {}).sort()).toEqual([
      'at',
      'orderId',
      'seq',
      'status',
    ]);
    expect(Object.keys(arrivals[1]?.payload ?? {}).sort()).toEqual([
      'at',
      'orderId',
      'previousStatus',
      'seq',
      'status',
    ]);
    const wire = JSON.stringify(arrivals);
    for (const secret of [USER_ID, MARKET_ID, internalNote, '4599', '+905551112233']) {
      expect(wire).not.toContain(secret);
    }
  });

  it("QA-RT3-04: at, zarfin occurredAt'i (gecisin ani); realtime'in yayin ani degil", async () => {
    const orderId = newOrderId();
    const { arrivals } = await client(orderId);
    const occurredAt = new Date(Date.now() - 90_000).toISOString();

    await publishAndAwait(arrivals, { ...transition(orderId, 2), occurredAt });

    expect(arrivals[0]?.payload['at']).toBe(occurredAt);
  });

  it('QA-RT3-05: akistaki baska konular onaylanir; bekleyen ve olu olay birakmaz, yayin yapmaz', async () => {
    const orderId = newOrderId();
    const { socket, arrivals } = await client(orderId);
    const deadBefore = (await deadLetters(redis.connection.redis)).length;
    const other = (topic: (typeof EVENTS)[keyof typeof EVENTS]) => ({
      eventId: newId(ID_PREFIX.EVENT),
      topic,
      partitionKey: orderId,
      occurredAt: new Date().toISOString(),
      payload: { orderId, userId: USER_ID, marketId: MARKET_ID },
    });
    const silence = collectEvents(socket, 'order.status');

    for (const topic of [EVENTS.ORDER_CREATED, EVENTS.STOCK_RESERVED, EVENTS.PAYMENT_SUCCEEDED]) {
      await redis.publisher.publish(other(topic));
    }
    await expect(silence).resolves.toEqual([]);

    expect(await publishAndAwait(arrivals, transition(orderId, 2))).toBeLessThan(
      DELIVERY_TARGET_MS,
    );
    await expect.poll(() => pendingCount(redis.connection.redis), { timeout: 5_000 }).toBe(0);
    const deadAfter = await deadLetters(redis.connection.redis);
    expect(
      deadAfter.slice(deadBefore).filter((entry) => entry['dead.group'] === EVENT_CONSUMER_GROUP),
    ).toEqual([]);
    expect(seqsOf(arrivals)).toEqual([2]);
  });

  it('QA-RT3-10: tek kopyada ayri ayri yazilan 10 ardisik gecis istemciye eksiksiz, tekrarsiz ve sirayla gelir', async () => {
    const orderId = newOrderId();
    const { arrivals } = await client(orderId);
    const versions = Array.from({ length: 10 }, (_, index) => index + 2);

    for (const version of versions) {
      await redis.publisher.publish(statusEnvelope(transition(orderId, version)));
    }

    await expect
      .poll(() => arrivals.length, { timeout: 3 * DELIVERY_TARGET_MS })
      .toBe(versions.length);
    expect(seqsOf(arrivals)).toEqual(versions);
  });

  it('QA-RT3-11: realtime yalnizca omurlu realtime: anahtari yazar (TTL kurali; akislar ADR-16 istisnasi)', async () => {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await redis.connection.redis.scan(cursor, 'COUNT', 100);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== '0');

    const realtimeKeys = keys.filter((key) => key.startsWith('realtime:'));
    // Olumlu kontrol: onceki testler surum anahtari yazdi.
    expect(realtimeKeys.length).toBeGreaterThan(0);
    for (const key of keys) {
      if (key === EVENTS_STREAM_KEY || key === EVENTS_DEAD_LETTER_STREAM_KEY) {
        continue;
      }
      // Bicim tek yerde uretilir (redis-kit realtimeSeqKey); elle birlestirilmis anahtar olmamali.
      const orderId = /ord_[0-9a-f]{32}/.exec(key)?.[0] ?? '';
      expect(key, 'beklenmeyen anahtar').toBe(
        orderId === '' ? 'realtime:<siparis>:seq' : realtimeSeqKey(orderId),
      );
      const ttl = await redis.connection.redis.pttl(key);
      expect(ttl, key).toBeGreaterThan(0);
      expect(ttl, key).toBeLessThanOrEqual(SEQ_TTL_MS);
    }
  });
});
