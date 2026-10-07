/**
 * QA kara kutu (T15.3; bekleyen is 122 ve 124): "kart cekimi BASARILI, cevap KAYBOLDU, kilit
 * DUSTU" ve iade yollari. Gercek order + payment + inventory + outbox aktaricisi ve payment
 * komut tuketicileri (qa-payment-world.ts).
 *
 *   L1 kilit supuruldu (inventory geri verdi): kullanici CreateOrder'i tekrarlar -> 410
 *      refunded:true; para BIR kez alinir, BIR kez geri verilir; tek iade komutu, tuketici kabul.
 *   L2 ayni durumda tekrar yerine order'in supurucusu: REFUNDED; ayni degismez.
 *   L3 saga tekrari ile supurucu AYNI ANDA (ikisi de getPayment'ta birbirini bekler): tek iptal,
 *      tek iade; komutlar tuketicide ikinci iade yapmaz.
 *   K1 3DS onayi payment'ta kapida beklerken kullanici iptal eder (odeme henuz alinmamis
 *      gorunur); onay basarili, cevap gelir: kilit yok, iptal cakisir, para IADE edilir.
 *   K2 BULGU #134 (MEVCUT davranis belgelenir): K1'in aynisi ama onayin cevabi KAYBOLUR: para
 *      alinmis kalir, hicbir yol iade etmez.
 *   D1 payment kapaliyken tekrar: 503, HICBIR sey yazilmaz; payment donunce L1 sonucu.
 *
 * Her senaryonun sonunda AYNI para ve stok denetimi (qa-money-checks.ts).
 */

import { ERROR_CODES, EVENTS, GRPC_STATUS, ORDER_STATUS } from '@getir/core';
import { EVENT_HANDLED } from '@getir/event-bus';
import { appErrorOf } from '@getir/service-kit/testing';
import { describe, expect, it } from 'vitest';

import {
  DEPENDENCY_BREAKER_FAILURE_THRESHOLD,
  IDEMPOTENT_RETRY_MAX,
} from '../../src/config/constants.js';
import { TEST_CARD } from '../support/fake-payments.js';
import { expectSettled, moneyOf, refundCommands, stockState } from '../support/qa-money-checks.js';
import type { StockState } from '../support/qa-money-checks.js';
import { PAST_LOCK_MS, useInventoryWorld, useShops } from '../support/qa-payment-world.js';
import type { Shop } from '../support/qa-payment-world.js';

const world = useInventoryWorld('qa_dusmus_kilit_iade');
const openShop = useShops(world);
/**
 * K1 ve K2: onay kapida beklerken kullanici iptali kosar. order -> payment siniri genis: sonuc
 * kapiya bagli kalsin, saate degil (iptal bu surede rahat biter; uyku yok).
 */
const GATED_PAYMENT_TIMEOUT_MS = 10_000;

/**
 * Kart cekilir, cevap KAYBOLUR: payment cekimi uygular, cevabi kapida bekletir; order kendi
 * sure sinirinda (gercek saat, islevsel 2 sn) SERVICE_UNAVAILABLE doner. Kapi order dondukten
 * SONRA acilir: bekleme order'in siniri kadar, uyku yok.
 */
async function chargedButLost(shop: Shop, orderId: string, userId: string): Promise<void> {
  const held = shop.faults.holdReply('charge', orderId);
  const first = await shop.createOrder(orderId, userId);
  held.open();
  expect(appErrorOf(first.error)?.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
  expect((await shop.orders.findById(orderId))?.status).toBe(ORDER_STATUS.AWAITING_PAYMENT);
  expect(await moneyOf(shop, orderId)).toEqual({ charged: 1, refunded: 0 });
}

/** Kilit dustu ve inventory stogu geri verdi (supurucu turu). */
async function lockSwept(): Promise<void> {
  world.clock.advance(PAST_LOCK_MS);
  await world.sweepInventory();
}

/** Outbox teslim edilir: her komut tuketicide KABUL edilir, para degismez. */
async function expectCommandsHandled(shop: Shop, orderId: string): Promise<void> {
  const money = await moneyOf(shop, orderId);
  const delivered = await shop.deliverPaymentCommands();
  expect(delivered.length).toBeGreaterThan(0);
  expect(delivered.map((entry) => entry.outcome)).toEqual(delivered.map(() => EVENT_HANDLED));
  expect(await moneyOf(shop, orderId)).toEqual(money);
}

/** L1, L2 ve D1'in ortak sonu: iptal, para bir kez alindi bir kez dondu, tek iade komutu. */
async function expectRefundedClose(shop: Shop, orderId: string, before: StockState) {
  await expectCommandsHandled(shop, orderId);
  expect(refundCommands(shop, orderId)).toBe(1);
  await expectSettled(world, shop, orderId, before, {
    status: ORDER_STATUS.CANCELLED,
    charged: 1,
    refunded: 1,
    onHandDelta: 0,
    committed: false,
  });
}

/** 3DS isteyen siparis: AWAITING_PAYMENT ve dogrulama kimligi. */
async function awaitingThreeDs(shop: Shop, userId: string) {
  const orderId = await shop.draft(userId);
  const before = await stockState(world, orderId);
  const created = await shop.createOrder(orderId, userId, TEST_CARD.CHALLENGE);
  const challengeId = created.response?.challengeId ?? '';
  expect(challengeId).not.toBe('');
  return { orderId, before, challengeId };
}

describe('QA #122 cekim basarili, cevap kayboldu, kilit dustu: IADE', () => {
  it('L1 kilit supuruldu; kullanici tekrar eder: 410 refunded, para bir kez alinir bir kez doner', async () => {
    const shop = await openShop();
    const userId = shop.nextUser();
    const orderId = await shop.draft(userId);
    const before = await stockState(world, orderId);
    await chargedButLost(shop, orderId, userId);
    await lockSwept();

    const retry = await shop.createOrder(orderId, userId);

    expect(retry.error?.code).toBe(GRPC_STATUS.FAILED_PRECONDITION);
    expect(appErrorOf(retry.error)).toMatchObject({
      code: ERROR_CODES.RESERVATION_EXPIRED,
      details: { orderId, status: 'CANCELLED', refunded: true },
    });
    expect(shop.faults.calls('charge', orderId)).toBe(1);
    await expectRefundedClose(shop, orderId, before);
  });

  it('L2 ayni durumda order supurucusu: REFUNDED; ayni degismez', async () => {
    const shop = await openShop();
    const userId = shop.nextUser();
    const orderId = await shop.draft(userId);
    const before = await stockState(world, orderId);
    await chargedButLost(shop, orderId, userId);
    await lockSwept();

    expect(await shop.sweepOrders()).toMatchObject({ refunded: 1, failed: 0 });

    await expectRefundedClose(shop, orderId, before);
  });

  it('L3 saga tekrari ve supurucu AYNI ANDA: tek iptal, tek iade; komutlar ikinci iade yapmaz', async () => {
    const shop = await openShop();
    const userId = shop.nextUser();
    const orderId = await shop.draft(userId);
    const before = await stockState(world, orderId);
    await chargedButLost(shop, orderId, userId);
    await lockSwept();
    // Iki yol da odeme kaydini okumadan once birbirini bekler: ikisi de "para alinmis" gorur.
    shop.faults.barrier('getPayment', orderId, 2);

    const [retry, round] = await Promise.all([
      shop.createOrder(orderId, userId),
      shop.sweepOrders(),
    ]);

    // Yaris gercekten kuruldu: iki yol da bariyerden gecti, ikisi de kapatmayi denedi.
    expect(shop.faults.calls('getPayment', orderId)).toBe(2);
    expect(round.failed).toBe(0);
    expect(round.refunded + round.skipped).toBe(1);
    expect(appErrorOf(retry.error)?.code).toBe(ERROR_CODES.RESERVATION_EXPIRED);
    const cancellations = shop.orders.recordedEvents.filter(
      (event) =>
        event.orderId === orderId &&
        event.topic === EVENTS.ORDER_STATUS_CHANGED &&
        event.payload['to'] === ORDER_STATUS.CANCELLED,
    );
    expect(cancellations).toHaveLength(1);
    await expectRefundedClose(shop, orderId, before);
  });

  it('K1 3DS onayi kapida beklerken kullanici iptal eder: onay basarili, iptal cakisir, para IADE', async () => {
    const shop = await openShop({ paymentTimeoutMs: GATED_PAYMENT_TIMEOUT_MS });
    const userId = shop.nextUser();
    const { orderId, before, challengeId } = await awaitingThreeDs(shop, userId);
    const confirmGate = shop.faults.holdBefore('confirm3Ds', orderId);
    const confirming = shop.confirm(orderId, userId, challengeId);
    await reachedPayment(confirmGate.arrived, confirming);

    // Odeme henuz alinmamis (REQUIRES_3DS): kullanici iptali gecer, kilit birakilir.
    expect((await shop.cancel(orderId, userId)).error).toBeUndefined();
    confirmGate.gate.open();
    const confirmed = await confirming;

    expect(appErrorOf(confirmed.error)?.code).toBe(ERROR_CODES.RESERVATION_EXPIRED);
    await expectCommandsHandled(shop, orderId);
    await expectSettled(world, shop, orderId, before, {
      status: ORDER_STATUS.CANCELLED,
      charged: 1,
      refunded: 1,
      onHandDelta: 0,
      committed: false,
    });
  });

  // BULGU #134: duzeltmeyle TERSINE donecek (refunded 1; payment cancel_requested SUCCEEDED'i iade
  // eder, gerekce order_cancelled). Bugun uc savunma da tutmuyor:
  // onay tekrari CANCELLED'da assertTransition'a takilir, order supurucusu CANCELLED'i taramaz,
  // payment.cancel_requested SUCCEEDED odemede NOTHING_TO_CANCEL der.
  it('K2 MEVCUT davranis: K1 ama onayin cevabi KAYBOLUR -> para alinmis kalir, hicbir yol iade etmez', async () => {
    const shop = await openShop({ paymentTimeoutMs: GATED_PAYMENT_TIMEOUT_MS });
    const userId = shop.nextUser();
    const { orderId, before, challengeId } = await awaitingThreeDs(shop, userId);
    const confirmGate = shop.faults.holdBefore('confirm3Ds', orderId, true);
    const confirming = shop.confirm(orderId, userId, challengeId);
    await reachedPayment(confirmGate.arrived, confirming);
    expect((await shop.cancel(orderId, userId)).error).toBeUndefined();
    confirmGate.gate.open();

    const lost = await confirming;

    expect(appErrorOf(lost.error)?.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
    // payment'ta para alindi; iptal komutu tuketicide "kapatilacak tahsilat yok" der.
    expect(await moneyOf(shop, orderId)).toEqual({ charged: 1, refunded: 0 });
    await expectCommandsHandled(shop, orderId);
    // Onay tekrari iptal edilmis sipariste ilerlemez; supurucu CANCELLED'i taramaz.
    const retry = await shop.confirm(orderId, userId, challengeId);
    expect(appErrorOf(retry.error)?.code).toBe(ERROR_CODES.ORDER_STATE_INVALID);
    expect(await shop.sweepOrders()).toMatchObject({ refunded: 0, failed: 0 });
    expect(refundCommands(shop, orderId)).toBe(0);
    await expectSettled(world, shop, orderId, before, {
      status: ORDER_STATUS.CANCELLED,
      charged: 1,
      refunded: 0,
      onHandDelta: 0,
      committed: false,
    });
  });

  it('D1 payment kapaliyken tekrar: 503 ve HICBIR sey yazilmaz; payment donunce L1 sonucu', async () => {
    // Devre kesici acilmamali: kayip cekimin hatasi + getPayment'in butun denemeleri esigin altinda.
    expect(1 + (IDEMPOTENT_RETRY_MAX + 1)).toBeLessThan(DEPENDENCY_BREAKER_FAILURE_THRESHOLD);
    const shop = await openShop();
    const userId = shop.nextUser();
    const orderId = await shop.draft(userId);
    const before = await stockState(world, orderId);
    await chargedButLost(shop, orderId, userId);
    await lockSwept();
    const awaiting = await shop.orders.findById(orderId);
    shop.faults.fail('getPayment', orderId);

    const down = await shop.createOrder(orderId, userId);

    expect(appErrorOf(down.error)?.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
    expect(shop.faults.calls('getPayment', orderId)).toBeGreaterThan(0);
    const unchanged = await shop.orders.findById(orderId);
    expect(unchanged?.status).toBe(ORDER_STATUS.AWAITING_PAYMENT);
    expect(unchanged?.version).toBe(awaiting?.version);
    expect(await moneyOf(shop, orderId)).toEqual({ charged: 1, refunded: 0 });
    expect(refundCommands(shop, orderId)).toBe(0);

    shop.faults.disarm('getPayment', orderId);
    const retry = await shop.createOrder(orderId, userId);

    expect(appErrorOf(retry.error)).toMatchObject({
      code: ERROR_CODES.RESERVATION_EXPIRED,
      details: { refunded: true },
    });
    expect(shop.faults.calls('charge', orderId)).toBe(1);
    await expectRefundedClose(shop, orderId, before);
  });
});

/**
 * Cagri payment'in kapisina ulasana kadar bekler. Ulasmadan sonuclanirsa test HEMEN duser (60 sn
 * beklemez). Kapidan sonra sonuclanmasi beklenendir: koruma sozu yutulur, yakalanmamis ret olmaz.
 */
async function reachedPayment(
  arrived: Promise<void>,
  call: Promise<{ readonly error?: Error | undefined }>,
): Promise<void> {
  let reached = false;
  const guard = call.then((result) => {
    if (!reached) {
      throw new Error(`cagri payment'a ulasmadan dondu: ${result.error?.message ?? 'basari'}`);
    }
  });
  guard.catch(() => undefined);
  await Promise.race([arrived.then(() => (reached = true)), guard]);
}
