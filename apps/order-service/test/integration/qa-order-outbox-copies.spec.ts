/**
 * QA kara kutu (T15.2, order geriye donuk PR 1; OQ2): outbox yayincisi IKI kopyada. Lider kilidi
 * yok (relay-outbox.ts): iki yayinci ayni bekleyenleri okuyabilir. Kopya 0'in yayincisi
 * bekleyenleri okuduktan sonra kapida bekletilir; o arada siparisler ilerler ve kopya 1 yayinlar;
 * sonra kopya 0 birakilir. Tuketiciler GERCEK: realtime'in isleyicisi + Redis surum deposu
 * (qa-realtime-sink.ts) ve payment'in komut isleyicileri (qa-order-cluster.ts).
 *
 *   O1 MEVCUT: gec kalan yayinci, okudugu ESKI surumleri yeni surumden (PAID) SONRA yayinlar; akista
 *      siparisin surum sirasi bozulur. realtime eskileri atlar (stale), odaya giden son durum PAID.
 *   O2 karisik siparisler (kart, 3DS, kapida odeme, ret, iki iptal): olay KAYBOLMAZ (bekleyen
 *      kalmaz; test akisi eventId ile tekillestirince her gecis bir kez, zaman cizelgesi sirasiyla).
 *      Tekrarlar AKISTA KALIR: hicbir tuketici eventId ile tekillestirmez (relay-outbox.ts yorumu
 *      boyle soylese de); realtime surumle korunur: her siparisin odaya giden surumu geri gitmez ve
 *      son olay siparisin son durumu.
 *   O3 payment komutlari (3DS beklerken iptal; parasi alinmis kilidi dusmus siparis) iki yayincidan
 *      tekrar ve gecikmeyle gelir, akis iki kez teslim edilir: hepsi islenir, etki TEK (bir iptal,
 *      bir iade).
 */

import { ERROR_CODES, EVENTS, ORDER_STATUS } from '@getir/core';
import type { OrderStatus } from '@getir/core';
import { orderV1 } from '@getir/proto';
import { appErrorOf } from '@getir/service-kit/testing';
import { describe, expect, it } from 'vitest';

import {
  ATTEMPT_KIND,
  ATTEMPT_OUTCOME,
  PAYMENT_STATUS,
} from '../../../payment-service/src/domain/payment.js';
import { TEST_CARD } from '../support/fake-payments.js';
import { gate } from '../support/qa-grpc-faults.js';
import { attemptCount, moneyOf } from '../support/qa-money-checks.js';
import { openChallenge, useOrderClusters } from '../support/qa-order-cluster.js';
import type { OrderCluster } from '../support/qa-order-cluster.js';
import {
  duplicates,
  eventCount,
  rawStatusChanges,
  statusChanges,
} from '../support/qa-order-stream.js';
import { PAST_LOCK_MS, useInventoryWorld } from '../support/qa-payment-world.js';
import { realtimeSink } from '../support/qa-realtime-sink.js';

const world = useInventoryWorld('qa_order_outbox_kopya');
const openCluster = useOrderClusters(world);

/** Bekleyen kalmadigini gormek icin okunan en fazla olay (kumede bundan cok olay yok). */
const PENDING_LIMIT = 500;

/**
 * Kopya 0'in yayincisi bekleyenleri OKUR ve ilk yayindan once kapida bekler; `during` o arada
 * kosar (siparisler ilerler), sonra kopya 1 yayinlar ve kopya 0 birakilir. Kopya 0 hic yayinlamadan
 * biterse (bekleyen yok ya da okuma hatasi) beklenmez, dusulur. Kapi her durumda acilir.
 */
async function overlappingRelays(
  cluster: OrderCluster,
  during: () => Promise<void> = () => Promise.resolve(),
): Promise<void> {
  const arrived = gate();
  const release = gate();
  const late = cluster.copy(0).relay({ arrived, release });
  try {
    const held = await Promise.race([arrived.opened.then(() => true), late.then(() => false)]);
    if (!held) throw new Error('kopya 0 yayinlamadan bitti: bekleyen olay yoktu');
    await during();
    await cluster.copy(1).relay();
  } finally {
    release.open();
  }
  await late;
}

/** Kartla odenmis, kapida odenmis ya da reddedilmis siparis (bir adimda). */
async function settledOrder(
  cluster: OrderCluster,
  pay: (orderId: string, userId: string) => Promise<unknown>,
): Promise<string> {
  const userId = cluster.nextUser();
  const orderId = await cluster.copy(1).calls.draft(userId);
  await pay(orderId, userId);
  return orderId;
}

async function statusOf(cluster: OrderCluster, orderId: string): Promise<OrderStatus | undefined> {
  return (await cluster.orders.findById(orderId))?.status;
}

describe('QA OQ2 outbox yayincisi iki kopyada (lider yok); tuketiciler gercek', () => {
  it('O1 MEVCUT: gec kalan yayinci eski surumleri PAID den sonra yayinlar; realtime eskileri atlar', async () => {
    const cluster = await openCluster();
    const sink = realtimeSink(world.stores.redis.redis);
    const { orderId, userId, challengeId } = await openChallenge(cluster);

    await overlappingRelays(cluster, async () => {
      // Kopya 0 AWAITING_PAYMENT'a kadarki surumleri okudu ve bekliyor; siparis PAID olur.
      const confirmed = await cluster.copy(1).calls.confirm(orderId, userId, challengeId);
      expect(confirmed.response?.status).toBe(orderV1.OrderStatus.ORDER_STATUS_PAID);
    });

    const unique = statusChanges(cluster.stream, orderId);
    expect(unique.map((change) => change.to)).toEqual([
      ORDER_STATUS.RISK_CHECK,
      ORDER_STATUS.RESERVED,
      ORDER_STATUS.AWAITING_PAYMENT,
      ORDER_STATUS.PAID,
    ]);
    const versions = unique.map((change) => change.version);
    // Akista: kopya 1 butun surumleri, ARDINDAN kopya 0 PAID'den onceki surumleri yeniden.
    expect(rawStatusChanges(cluster.stream, orderId).map((change) => change.version)).toEqual([
      ...versions,
      ...versions.slice(0, -1),
    ]);
    const writers = cluster.stream
      .filter(({ envelope }) => envelope.partitionKey === orderId)
      .filter(({ envelope }) => envelope.topic === EVENTS.ORDER_STATUS_CHANGED)
      .map(({ copy }) => copy);
    expect(writers).toEqual([...versions.map(() => 1), ...versions.slice(0, -1).map(() => 0)]);

    const outcomes = await sink.deliver(cluster.stream);
    expect(outcomes.every((outcome) => outcome.kind === 'handled')).toBe(true);
    const seen = sink.emitted.filter((event) => event.orderId === orderId);
    expect(seen.map((event) => event.seq)).toEqual(versions);
    expect(seen.at(-1)?.status).toBe(ORDER_STATUS.PAID);
    expect(sink.stale()).toBe(versions.length - 1);
    expect(sink.dropped()).toBe(0);
  });

  it('O2 karisik siparisler: olay kaybolmaz; tekrarlar akista kalir, realtime da surum geri gitmez', async () => {
    const cluster = await openCluster();
    const sink = realtimeSink(world.stores.redis.redis);
    const card = await settledOrder(cluster, (id, user) =>
      cluster.copy(0).calls.createOrder(id, user),
    );
    const onDelivery = await settledOrder(cluster, (id, user) =>
      cluster.copy(1).calls.payOnDelivery(id, user),
    );
    const threeDs = await openChallenge(cluster);
    const cancelled = await openChallenge(cluster);
    let declined = '';
    let draftCancelled = '';

    await overlappingRelays(cluster, async () => {
      const confirmed = await cluster
        .copy(0)
        .calls.confirm(threeDs.orderId, threeDs.userId, threeDs.challengeId);
      expect(confirmed.error).toBeUndefined();
      const cancel = await cluster.copy(1).calls.cancel(cancelled.orderId, cancelled.userId);
      expect(cancel.error).toBeUndefined();
      declined = await settledOrder(cluster, async (id, user) => {
        const result = await cluster.copy(0).calls.createOrder(id, user, TEST_CARD.DECLINED);
        expect(appErrorOf(result.error)?.code).toBe(ERROR_CODES.PAYMENT_DECLINED);
        return result;
      });
      draftCancelled = await settledOrder(cluster, (id, user) =>
        cluster.copy(1).calls.cancel(id, user),
      );
    });
    // Kalan (kopya 0 birakilirken yazilan) varsa son tur; sonra bekleyen KALMAZ.
    await cluster.copy(0).relay();
    // Iki kopya ayni outbox koleksiyonunu okur: bir kez bakmak yeter.
    expect(await cluster.copy(0).store.outbox.pending(PENDING_LIMIT)).toEqual([]);
    expect(duplicates(cluster.stream)).toBeGreaterThan(0);

    const expected: Record<string, OrderStatus> = {
      [card]: ORDER_STATUS.PAID,
      [onDelivery]: ORDER_STATUS.PAID,
      [threeDs.orderId]: ORDER_STATUS.PAID,
      [cancelled.orderId]: ORDER_STATUS.CANCELLED,
      [declined]: ORDER_STATUS.PAYMENT_FAILED,
      [draftCancelled]: ORDER_STATUS.CANCELLED,
    };
    const outcomes = await sink.deliver(cluster.stream);
    expect(outcomes.every((outcome) => outcome.kind === 'handled')).toBe(true);
    for (const [orderId, status] of Object.entries(expected)) {
      const order = await cluster.orders.findById(orderId);
      expect(order?.status, orderId).toBe(status);
      // Her gecis akista, bir kez (tekillestirince), zaman cizelgesi sirasiyla; surum artar.
      const changes = statusChanges(cluster.stream, orderId);
      expect(
        changes.map((change) => change.to),
        orderId,
      ).toEqual((order?.timeline ?? []).slice(1).map((entry) => entry.status));
      expectIncreasing(
        changes.map((change) => change.version),
        orderId,
      );
      expect(eventCount(cluster.stream, orderId, EVENTS.ORDER_CREATED), orderId).toBe(1);
      // realtime: odaya giden surum geri gitmez; son olay son durum.
      const seen = sink.emitted.filter((event) => event.orderId === orderId);
      expectNonDecreasing(
        seen.map((event) => event.seq),
        orderId,
      );
      expect(seen.at(-1)?.status, orderId).toBe(status);
    }
    expect(sink.dropped()).toBe(0);
  });

  it('O3 payment komutlari tekrar ve gecikmeyle gelir: hepsi islenir, bir iptal ve bir iade', async () => {
    const cluster = await openCluster();
    const cancelled = await openChallenge(cluster);
    const lapsed = await openChallenge(cluster);
    // Onay payment'ta kabul edildi, cevap kayboldu: para alindi, siparis odeme bekliyor.
    cluster.faults.dropReply('confirm3Ds', lapsed.orderId);
    const lost = await cluster
      .copy(0)
      .calls.confirm(lapsed.orderId, lapsed.userId, lapsed.challengeId);
    expect(appErrorOf(lost.error)?.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);

    const cancel = await cluster.copy(1).calls.cancel(cancelled.orderId, cancelled.userId);
    expect(cancel.error).toBeUndefined();
    // Kilit duser; supurucu parasi alinmis siparisi kapatir: CANCELLED + iptal ve iade komutu.
    world.clock.advance(PAST_LOCK_MS);
    await world.sweepInventory();
    await cluster.copy(1).sweep();
    expect(await statusOf(cluster, cancelled.orderId)).toBe(ORDER_STATUS.CANCELLED);
    expect(await statusOf(cluster, lapsed.orderId)).toBe(ORDER_STATUS.CANCELLED);

    // Komutlar iki yayincinin batch'inde: akista her komut iki kez, ikincisi gecikmeli.
    await overlappingRelays(cluster);
    const commands = [
      [cancelled.orderId, EVENTS.PAYMENT_CANCEL_REQUESTED],
      [lapsed.orderId, EVENTS.PAYMENT_CANCEL_REQUESTED],
      [lapsed.orderId, EVENTS.PAYMENT_REFUND_REQUESTED],
    ] as const;
    for (const [orderId, topic] of commands) {
      expect(eventCount(cluster.stream, orderId, topic), `${orderId} ${topic}`).toBe(1);
    }

    // Akisin tamami (tekrarlar dahil) iki kez: yeniden teslim de etkisiz.
    for (let round = 0; round < 2; round += 1) {
      const outcomes = await cluster.deliverPaymentCommands(0);
      expect(outcomes).toHaveLength(2 * commands.length);
      expect(outcomes.every((outcome) => outcome.kind === 'handled')).toBe(true);
    }

    const voided = await cluster.payments.findByOrderId(cancelled.orderId);
    expect(voided?.status).toBe(PAYMENT_STATUS.CANCELLED);
    expect(attemptCount(voided, ATTEMPT_KIND.CANCEL, ATTEMPT_OUTCOME.CANCELLED)).toBe(1);
    expect(await moneyOf(cluster, cancelled.orderId)).toEqual({ charged: 0, refunded: 0 });
    const refunded = await cluster.payments.findByOrderId(lapsed.orderId);
    expect(refunded?.status).toBe(PAYMENT_STATUS.REFUNDED);
    expect(await moneyOf(cluster, lapsed.orderId)).toEqual({ charged: 1, refunded: 1 });
  });
});

function expectIncreasing(values: readonly number[], label: string): void {
  for (let index = 1; index < values.length; index += 1) {
    expect(values[index], label).toBeGreaterThan(values[index - 1] ?? 0);
  }
}

function expectNonDecreasing(values: readonly number[], label: string): void {
  for (let index = 1; index < values.length; index += 1) {
    expect(values[index], label).toBeGreaterThanOrEqual(values[index - 1] ?? 0);
  }
}
