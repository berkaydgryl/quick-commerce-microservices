/**
 * QA kara kutu (T12.3): olay hattinin kotu gunleri. Her test kendi Redis'iyle
 * (Testcontainers) baslar; grup ve akis durumu testler arasinda tasinmaz.
 *
 *  - bozuk govde olu olaylara gider (D8), kaynak onaylanir, yayin olmaz;
 *  - coken kopyanin onaylamadigi kayit sahiplenilip yayinlanir; surumu
 *    kaydedip yayinlayamadan coken kopyanin olayi da (D2, en az bir kez);
 *  - realtime kapaliyken yazilan olay acilinca islenir (grup kaldigi yerden);
 *  - kapanan kopya kayit kaybettirmez (D9: once dinleme durur, eldeki parti biter);
 *  - iki kopya, cok siparis: olay baska siparisin odasina sizmaz; ara surum
 *    atlanabilir (K4, T12.3 raporu) ama son surum 1 sn icinde gelir.
 */

import { setTimeout as delay } from 'node:timers/promises';

import { toStreamFields } from '@getir/event-bus';
import { EVENTS_STREAM_KEY, realtimeSeqKey } from '@getir/redis-kit';
import type { Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';

import type { RealtimeServer } from '../../src/bootstrap.js';
import { EVENT_CONSUMER_GROUP, SEQ_TTL_MS } from '../../src/config/constants.js';
import { collectEvents } from '../support/clients.js';
import {
  deadLetters,
  DELIVERY_TARGET_MS,
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
import type { Arrival, QaNodeOptions, QaRedis } from '../support/qa-event-harness.js';

/** Sahiplenme testinde kisa bekleme: uretimdeki 30 sn'yi beklememek icin. Digerleri uretim ayari. */
const SHORT_CLAIM_IDLE_MS = 1_000;

let redis: QaRedis | undefined;
let nodes: RealtimeServer[] = [];
let sockets: Socket[] = [];

afterEach(async () => {
  for (const socket of sockets) {
    socket.close();
  }
  sockets = [];
  await Promise.all(nodes.map((node) => node.shutdown('qa testi bitti')));
  nodes = [];
  await redis?.stop();
  redis = undefined;
});

async function freshRedis(): Promise<QaRedis> {
  redis = await startQaRedis();
  return redis;
}

async function node(qa: QaRedis, options: QaNodeOptions): Promise<RealtimeServer> {
  const started = await startQaNode(qa.url, options);
  nodes.push(started);
  return started;
}

async function watch(
  server: RealtimeServer,
  orderId: string,
): Promise<{ socket: Socket; arrivals: Arrival[] }> {
  const socket = await orderClient(server.port, orderId);
  sockets.push(socket);
  return { socket, arrivals: recordArrivals(socket) };
}

function hasSeq(arrivals: readonly Arrival[], seq: number): boolean {
  return arrivals.some((arrival) => arrival.payload['seq'] === seq);
}

describe('QA T12.3: olay hattinin kotu gunleri', () => {
  it('QA-RT3-02: sozlesme disi govde olu olaylara gider; kaynak onaylanir, yayin ve surum kaydi olmaz', async () => {
    const qa = await freshRedis();
    const realtime = await node(qa, { name: 'qa-olu-olay' });
    const orderId = newOrderId();
    const { socket } = await watch(realtime, orderId);
    const silence = collectEvents(socket, 'order.status');

    const withoutTo = statusEnvelope(transition(orderId, 2));
    const { to: _dropped, ...payloadWithoutTo } = withoutTo.payload;
    const rejected = [
      statusEnvelope({ ...transition(orderId, 2), version: 0 }),
      statusEnvelope({ ...transition(orderId, 2), to: 'TELEPORTED' }),
      statusEnvelope({
        ...transition(orderId, 2),
        extra: { orderId: 'usr_0123456789abcdef0123456789abcdef' },
      }),
      { ...withoutTo, payload: payloadWithoutTo },
    ];
    for (const envelope of rejected) {
      await qa.publisher.publish(envelope);
    }
    // Govdesi JSON olmayan kayit: yayinci yazmaz, elle XADD (bozuk uretici).
    const fields = toStreamFields(statusEnvelope(transition(orderId, 2)));
    const payloadIndex = fields.indexOf('payload');
    fields[payloadIndex + 1] = '{bozuk json';
    await qa.connection.redis.xadd(EVENTS_STREAM_KEY, '*', ...fields);

    await expect
      .poll(async () => (await deadLetters(qa.connection.redis)).length, { timeout: 10_000 })
      .toBe(rejected.length + 1);
    const dead = await deadLetters(qa.connection.redis);
    expect(dead.map((entry) => entry['dead.group'])).toEqual(
      Array(dead.length).fill(EVENT_CONSUMER_GROUP),
    );
    expect(dead.map((entry) => entry['dead.reason'])).toEqual([
      'rejected',
      'rejected',
      'rejected',
      'rejected',
      'malformed',
    ]);
    expect(dead.every((entry) => (entry['dead.sourceId'] ?? '') !== '')).toBe(true);
    await expect.poll(() => pendingCount(qa.connection.redis), { timeout: 5_000 }).toBe(0);
    await expect(silence).resolves.toEqual([]);
    expect(await qa.connection.redis.exists(realtimeSeqKey(orderId))).toBe(0);

    // Olumlu kontrol: ayni istemci gecerli govdeyi alir (sessizlik baglanti yuzunden degil).
    const arrivals = recordArrivals(socket);
    await qa.publisher.publish(statusEnvelope(transition(orderId, 2)));
    await expect.poll(() => seqsOf(arrivals), { timeout: 5_000 }).toEqual([2]);
  }, 30_000);

  it('QA-RT3-06: coken kopyanin onaylamadigi kayit sahiplenilir ve yayinlanir; surumu kaydedip coken kopyaninki de (D2)', async () => {
    const qa = await freshRedis();
    // Grup daha onceki bir dagitimdan kalmis gibi: LATEST ile, akis bos.
    await qa.connection.redis.xgroup(
      'CREATE',
      EVENTS_STREAM_KEY,
      EVENT_CONSUMER_GROUP,
      '$',
      'MKSTREAM',
    );
    // Istemciler olay DINLEMEYEN bir kopyada: yayin Redis adapter ile gelir.
    const viewer = await node(qa, { name: 'qa-izleyici', listens: false });
    const [plain, recorded] = [newOrderId(), newOrderId()];
    const plainClient = await watch(viewer, plain);
    const recordedClient = await watch(viewer, recorded);

    await qa.publisher.publish(statusEnvelope(transition(plain, 3)));
    await qa.publisher.publish(statusEnvelope(transition(recorded, 3)));
    // Coken kopya: kayitlari okur, onaylamaz.
    const read: unknown = await qa.connection.redis.xreadgroup(
      'GROUP',
      EVENT_CONSUMER_GROUP,
      'qa-coken-kopya',
      'COUNT',
      10,
      'STREAMS',
      EVENTS_STREAM_KEY,
      '>',
    );
    expect(JSON.stringify(read)).toContain(plain);
    expect(await pendingCount(qa.connection.redis, 'qa-coken-kopya')).toBe(2);
    // Ikinci siparisin surumunu yayindan ONCE kaydetmis ve sonra cokmus.
    await qa.connection.redis.zadd(realtimeSeqKey(recorded), 3, 'seq');
    await qa.connection.redis.pexpire(realtimeSeqKey(recorded), SEQ_TTL_MS);

    await node(qa, { name: 'qa-varis', delivery: { claimIdleMs: SHORT_CLAIM_IDLE_MS } });

    await expect.poll(() => hasSeq(plainClient.arrivals, 3), { timeout: 10_000 }).toBe(true);
    await expect.poll(() => hasSeq(recordedClient.arrivals, 3), { timeout: 10_000 }).toBe(true);
    await expect.poll(() => pendingCount(qa.connection.redis), { timeout: 5_000 }).toBe(0);
    expect(seqsOf(plainClient.arrivals)).toEqual([3]);
    expect(seqsOf(recordedClient.arrivals)).toEqual([3]);
  }, 30_000);

  it('QA-RT3-07: realtime kapaliyken yazilan gecis, yeniden acilinca islenir (grup kaldigi yerden okur)', async () => {
    const qa = await freshRedis();
    const first = await node(qa, { name: 'qa-ilk' });
    await first.shutdown('qa: realtime kapaniyor');
    const viewer = await node(qa, { name: 'qa-izleyici', listens: false });
    const orderId = newOrderId();
    const { arrivals } = await watch(viewer, orderId);

    await qa.publisher.publish(statusEnvelope(transition(orderId, 2)));
    await delay(DELIVERY_TARGET_MS / 2);
    expect(arrivals).toEqual([]);

    await node(qa, { name: 'qa-yeniden' });

    await expect.poll(() => seqsOf(arrivals), { timeout: 5_000 }).toEqual([2]);
  }, 30_000);

  it('QA-RT3-08: kopya kapanirken kayit kaybolmaz; kapanan kopyada bekleyen kalmaz, son surum 1 sn icinde gelir', async () => {
    const qa = await freshRedis();
    const leaving = await node(qa, { name: 'qa-kapanan' });
    const staying = await node(qa, { name: 'qa-kalan' });
    const orderId = newOrderId();
    const { arrivals } = await watch(staying, orderId);
    const last = 31;
    let lastSentAt = 0;

    const publishing = (async () => {
      for (let version = 2; version <= last; version += 1) {
        lastSentAt = Date.now();
        await qa.publisher.publish(statusEnvelope(transition(orderId, version)));
      }
    })();
    await expect.poll(() => arrivals.length, { timeout: 5_000, interval: 5 }).toBeGreaterThan(0);
    await leaving.shutdown('qa: kopya kapaniyor');
    await publishing;

    await expect.poll(() => hasSeq(arrivals, last), { timeout: 5_000, interval: 5 }).toBe(true);
    const lastArrival = arrivals.find((arrival) => arrival.payload['seq'] === last);
    expect((lastArrival?.at ?? Number.POSITIVE_INFINITY) - lastSentAt).toBeLessThan(
      DELIVERY_TARGET_MS,
    );
    expect(await pendingCount(qa.connection.redis, 'qa-kapanan')).toBe(0);
    await expect.poll(() => pendingCount(qa.connection.redis), { timeout: 5_000 }).toBe(0);
    const seqs = seqsOf(arrivals);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(seqs.every((seq) => seq >= 2 && seq <= last)).toBe(true);
  }, 30_000);

  it('QA-RT3-09: iki kopya, bes siparis: olay baska odaya sizmaz, tekrar yok, son surum her istemcide 1 sn icinde', async () => {
    const qa = await freshRedis();
    const copies = [await node(qa, { name: 'qa-a' }), await node(qa, { name: 'qa-b' })];
    const orders = Array.from({ length: 5 }, () => newOrderId());
    const watchers = await Promise.all(
      orders.flatMap((orderId) =>
        copies.map(async (copy) => ({ orderId, ...(await watch(copy, orderId)) })),
      ),
    );
    const last = 7;
    const lastSentAt = new Map<string, number>();

    for (let version = 2; version <= last; version += 1) {
      for (const orderId of orders) {
        if (version === last) {
          lastSentAt.set(orderId, Date.now());
        }
        await qa.publisher.publish(statusEnvelope(transition(orderId, version)));
      }
    }

    for (const watcher of watchers) {
      await expect
        .poll(() => hasSeq(watcher.arrivals, last), { timeout: 5_000, interval: 5 })
        .toBe(true);
      const seqs = seqsOf(watcher.arrivals);
      // K4: ara surum atlanabilir; gelenler uretilenlerin alt kumesi, tekrarsiz.
      expect(new Set(seqs).size, watcher.orderId).toBe(seqs.length);
      expect(
        seqs.every((seq) => seq >= 2 && seq <= last),
        watcher.orderId,
      ).toBe(true);
      expect(
        watcher.arrivals.every((arrival) => arrival.payload['orderId'] === watcher.orderId),
      ).toBe(true);
      const finalArrival = watcher.arrivals.find((arrival) => arrival.payload['seq'] === last);
      expect(
        (finalArrival?.at ?? Number.POSITIVE_INFINITY) - (lastSentAt.get(watcher.orderId) ?? 0),
      ).toBeLessThan(DELIVERY_TARGET_MS);
    }
    await expect.poll(() => pendingCount(qa.connection.redis), { timeout: 5_000 }).toBe(0);
  }, 30_000);
});
