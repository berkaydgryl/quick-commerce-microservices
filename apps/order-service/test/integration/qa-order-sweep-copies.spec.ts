/**
 * QA kara kutu (T15.2, order geriye donuk PR 2; OQ4): siparis SUPURUCUSU iki kopyada, N kilidi
 * dusmus siparis. Lider kilidi yok (sweep-expired-reservations.ts, karar 3a): iki supurucu ayni
 * partiyi okur. Kapi: ikisi de partiyi OKUDUKTAN sonra bulusur, sonra yazar; her siparisi iki
 * supurucu da dener. Iki order kopyasi tek Mongo'da, GERCEK payment ve inventory
 * (qa-order-cluster.ts). #122 L3 tek siparisin ikili yarisiydi; burada N siparis.
 *
 *   W1 kilit inventory'de duruyor (inventory supurucusu kosmadi): taslaklar ve 3DS bekleyenler
 *      CANCELLED, kilit BIR kez birakilir (sayac siparis basina +2, defterde tek release); odeme
 *      asamasindakine tek cancel_requested. Parasi alinmis siparis PAID (#124 yolu): tek Commit,
 *      iade yok. Iki turun toplami: N kapatildi, N atlandi (her siparisi digeri de denedi), hata 0.
 *   W2 kilidi inventory'nin supurucusu dusurmus, parasi alinmis siparisler: CANCELLED, para BIR kez
 *      iade, tek refund_requested ve tek cancel_requested; komutlar payment'a iki kez gelse de etki tek.
 */

import { ERROR_CODES, EVENTS, ORDER_STATUS } from '@getir/core';
import type { OrderStatus } from '@getir/core';
import { appErrorOf } from '@getir/service-kit/testing';
import { describe, expect, it } from 'vitest';

import { LEDGER_KINDS } from '../../../inventory-service/src/domain/stock-ledger.js';
import type { SweepRound } from '../../src/application/sweep-expired-reservations.js';
import { DEPENDENCY_BREAKER_FAILURE_THRESHOLD } from '../../src/config/constants.js';
import type { ExpiredOrderFinder } from '../../src/domain/expired-order-finder.js';
import { gate } from '../support/qa-grpc-faults.js';
import type { Gate } from '../support/qa-grpc-faults.js';
import { moneyOf, stockState } from '../support/qa-money-checks.js';
import { openChallenge, useOrderClusters } from '../support/qa-order-cluster.js';
import { openLocks } from '../support/qa-order-saga-invariants.js';
import type { OrderCluster } from '../support/qa-order-cluster.js';
import { eventCount, statusChanges } from '../support/qa-order-stream.js';
import { DRAFT_QUANTITY, PAST_LOCK_MS, useInventoryWorld } from '../support/qa-payment-world.js';

const world = useInventoryWorld('qa_order_supurucu_kopya');
const openCluster = useOrderClusters(world);

const DRAFTS = 4;
const AWAITING = 3;
const CHARGED = 3;
const SWEEPERS = 2;

/**
 * Iki supurucu partiyi OKUDUKTAN sonra bulusur (yalniz ilk tur): ikisi de ayni siparisleri gorur,
 * sonra yazmaya baslar. Okuma basarisizsa bulusma beklenmez (tur zaten duser).
 */
function readTogether(): (finder: ExpiredOrderFinder) => ExpiredOrderFinder {
  const arrivals: Gate[] = [];
  return (finder) => ({
    findExpiredReservations: async (now, limit) => {
      const batch = await finder.findExpiredReservations(now, limit);
      if (arrivals.length < SWEEPERS) {
        const mine = gate();
        arrivals.push(mine);
        if (arrivals.length === SWEEPERS) for (const arrival of arrivals) arrival.open();
        await mine.opened;
      }
      return batch;
    },
  });
}

/** Taslakta kalmis siparis (kopya 1'de). */
async function draftOnly(cluster: OrderCluster): Promise<string> {
  return cluster.copy(1).calls.draft(cluster.nextUser());
}

/**
 * Onay payment'ta KABUL edildi, cevap kayboldu: para alindi, siparis odeme bekliyor. Kaybolan
 * cevap kopyanin payment devresine "ulasilamaz" sayilir (D17): ust uste esik kadarinda devre acilir
 * ve supurucu payment'a gidemez. Duzenek onaylari kopyalara dagitir, esigin altinda kalir.
 */
async function chargedButAwaiting(cluster: OrderCluster, index: number): Promise<string> {
  const { orderId, userId, challengeId } = await openChallenge(cluster);
  cluster.faults.dropReply('confirm3Ds', orderId);
  const lost = await cluster.copy(index % SWEEPERS).calls.confirm(orderId, userId, challengeId);
  expect(appErrorOf(lost.error)?.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
  return orderId;
}

async function times<T>(count: number, make: (index: number) => Promise<T>): Promise<T[]> {
  const made: T[] = [];
  for (let index = 0; index < count; index += 1) made.push(await make(index));
  return made;
}

/** Iki supurucu ayni anda; turlarin toplami. */
async function sweepTogether(cluster: OrderCluster): Promise<SweepRound> {
  const rounds = await Promise.all([cluster.copy(0).sweep(), cluster.copy(1).sweep()]);
  const total = (key: keyof SweepRound) => rounds.reduce((sum, round) => sum + round[key], 0);
  return {
    closedDrafts: total('closedDrafts'),
    closedAwaitingPayment: total('closedAwaitingPayment'),
    refunded: total('refunded'),
    completedPaid: total('completedPaid'),
    waiting: total('waiting'),
    skipped: total('skipped'),
    failed: total('failed'),
  };
}

/** Siparisin defter kayitlari, ture gore. */
async function ledgerOf(orderId: string): Promise<Readonly<Record<string, number>>> {
  return (await stockState(world, orderId)).ledger;
}

async function expectStatus(
  cluster: OrderCluster,
  orderIds: readonly string[],
  status: OrderStatus,
) {
  for (const orderId of orderIds) {
    const order = await cluster.orders.findById(orderId);
    expect(order?.status, orderId).toBe(status);
    const entries = (order?.timeline ?? []).filter((entry) => entry.status === status);
    expect(entries, `${orderId} zaman cizelgesinde tek ${status}`).toHaveLength(1);
  }
}

describe('QA OQ4 siparis supurucusu iki kopyada, N kilidi dusmus siparis', () => {
  it('W1 kilit duruyor: taslak ve 3DS bekleyen tek iptal, tek birakma; parasi alinmis tek Commit ile PAID', async () => {
    const cluster = await openCluster({ expired: readTogether() });
    const drafts = await times(DRAFTS, () => draftOnly(cluster));
    const awaiting = await times(AWAITING, async () => (await openChallenge(cluster)).orderId);
    const charged = await times(CHARGED, (index) => chargedButAwaiting(cluster, index));
    const all = [...drafts, ...awaiting, ...charged];
    const before = await stockState(world, all[0] ?? '');
    world.clock.advance(PAST_LOCK_MS);

    const round = await sweepTogether(cluster);

    expect(round).toMatchObject({
      closedDrafts: DRAFTS,
      closedAwaitingPayment: AWAITING,
      completedPaid: CHARGED,
      refunded: 0,
      waiting: 0,
      skipped: all.length,
      failed: 0,
    });
    await expectStatus(cluster, [...drafts, ...awaiting], ORDER_STATUS.CANCELLED);
    await expectStatus(cluster, charged, ORDER_STATUS.PAID);
    const after = await stockState(world, all[0] ?? '');
    // Birakilan kilit sayaca BIR kez doner; kesinlesen stok eldekinden BIR kez duser.
    expect(after.counter - before.counter).toBe(DRAFT_QUANTITY * (DRAFTS + AWAITING));
    expect(before.onHand - after.onHand).toBe(DRAFT_QUANTITY * CHARGED);
    for (const orderId of [...drafts, ...awaiting]) {
      expect(await ledgerOf(orderId), orderId).toEqual({ [LEDGER_KINDS.RELEASE]: 1 });
    }
    for (const orderId of charged) {
      expect(await ledgerOf(orderId), orderId).toEqual({ [LEDGER_KINDS.COMMIT]: 1 });
      expect(await moneyOf(cluster, orderId), orderId).toEqual({ charged: 1, refunded: 0 });
    }
    const locks = await openLocks(world);
    expect(all.filter((orderId) => locks.has(orderId))).toEqual([]);

    await cluster.copy(0).relay();
    for (const orderId of all) {
      const last = statusChanges(cluster.stream, orderId).at(-1)?.to;
      expect(last, orderId).toBe(
        charged.includes(orderId) ? ORDER_STATUS.PAID : ORDER_STATUS.CANCELLED,
      );
      const cancels = eventCount(cluster.stream, orderId, EVENTS.PAYMENT_CANCEL_REQUESTED);
      expect(cancels, orderId).toBe(awaiting.includes(orderId) ? 1 : 0);
      expect(eventCount(cluster.stream, orderId, EVENTS.PAYMENT_REFUND_REQUESTED), orderId).toBe(0);
    }
  });

  it('W2 kilit inventory de dusmus, para alinmis: tek iptal, para BIR kez iade, tek iade komutu', async () => {
    // Kopya basina kaybolan onay devre esiginin altinda kalmali (yoksa supurucu devre disi bulur).
    expect(Math.ceil((CHARGED + AWAITING) / SWEEPERS)).toBeLessThan(
      DEPENDENCY_BREAKER_FAILURE_THRESHOLD,
    );
    const cluster = await openCluster({ expired: readTogether() });
    const charged = await times(CHARGED + AWAITING, (index) => chargedButAwaiting(cluster, index));
    world.clock.advance(PAST_LOCK_MS);
    await world.sweepInventory();
    const before = await stockState(world, charged[0] ?? '');

    const round = await sweepTogether(cluster);

    expect(round).toMatchObject({
      closedDrafts: 0,
      closedAwaitingPayment: charged.length,
      refunded: charged.length,
      completedPaid: 0,
      waiting: 0,
      skipped: charged.length,
      failed: 0,
    });
    await expectStatus(cluster, charged, ORDER_STATUS.CANCELLED);
    // Kilidi inventory birakmisti: supurucu stoga bir daha dokunmaz.
    expect((await stockState(world, charged[0] ?? '')).counter).toBe(before.counter);
    await cluster.copy(1).relay();
    for (const orderId of charged) {
      expect(await ledgerOf(orderId), orderId).toEqual({ [LEDGER_KINDS.EXPIRE]: 1 });
      expect(eventCount(cluster.stream, orderId, EVENTS.PAYMENT_REFUND_REQUESTED), orderId).toBe(1);
      expect(eventCount(cluster.stream, orderId, EVENTS.PAYMENT_CANCEL_REQUESTED), orderId).toBe(1);
    }

    // Komutlar (iade, iptal) yeniden teslimle iki kez: etki yine tek.
    for (let delivery = 0; delivery < 2; delivery += 1) {
      const outcomes = await cluster.deliverPaymentCommands(0);
      expect(outcomes.every((outcome) => outcome.kind === 'handled')).toBe(true);
    }
    for (const orderId of charged) {
      expect(await moneyOf(cluster, orderId), orderId).toEqual({ charged: 1, refunded: 1 });
    }
  });
});
