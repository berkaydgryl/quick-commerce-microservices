/**
 * QA kara kutu (T15.2, order geriye donuk PR 1; OQ3): ConfirmPayment YARISLARI. Iki order kopyasi
 * tek Mongo'da, GERCEK payment (mock saglayici) ve inventory (qa-order-cluster.ts). Yaris payment'in
 * gRPC'sinde kapilarla kurulur (qa-payment-faults.ts): sonuc saate bagli degil.
 *
 *   R1 ayni dogru kod iki kopyadan, payment'ta bulusur (bariyer): ikisi de PAID, etki tek.
 *   R2 ayni dogru kod; ikincisi payment'ta ilki BITENE kadar bekler: PAID, ikinci commit yok.
 *   R3 dogru ve yanlis kod payment'ta bulusur: son durum PAID; yanlisin cevabi PAID ya da kalan
 *      hakli ret (iki sira da R4, R5'te ayrica).
 *   R4 yanlis kod payment'ta bekler, dogru kod biter: yanlis kodun cevabi da PAID (MEVCUT: payment
 *      sonuclanmis dogrulamanin sonucunu koda bakmadan tekrar verir; kod denenmez, hak dusmez).
 *   R5 dogru kod payment'ta bekler, yanlis kod biter: ret (kalan hak 2), siparis bekler; sonra PAID.
 *   R6 SON hak: dogru ve yanlis kod. Hangisi once islenirse sonuc ona gore ve TUTARLI: PAID (para 1,
 *      stok kesin) ya da PAYMENT_FAILED (para 0, kilit birakildi). Iki sira da ayrica kapiyla.
 *
 * PAID denetimi her senaryoda ayni (expectPaidOnce): para bir kez, iade yok, stok bir kez kesin,
 * zaman cizelgesinde ve akista tek PAID, kurye kuyruguna giris ani = odeme ani (#92), iade ya da
 * iptal komutu yok. K1/K2 (iptal ile onay) qa-lapsed-refund.spec.ts'te.
 */

import { ERROR_CODES, EVENTS, ORDER_STATUS } from '@getir/core';
import type { OrderStatus } from '@getir/core';
import { orderV1 } from '@getir/proto';
import { appErrorOf } from '@getir/service-kit/testing';
import type { CallResult } from '@getir/service-kit/testing';
import { describe, expect, it } from 'vitest';

import { ATTEMPT_KIND, ATTEMPT_OUTCOME } from '../../../payment-service/src/domain/payment.js';
import { attemptCount, expectSettled, stockState } from '../support/qa-money-checks.js';
import type { Settlement, StockState } from '../support/qa-money-checks.js';
import { WRONG_CODE } from '../support/qa-order-calls.js';
import { openChallenge, useOrderClusters } from '../support/qa-order-cluster.js';
import type { OrderCluster } from '../support/qa-order-cluster.js';
import { eventCount, statusChanges } from '../support/qa-order-stream.js';
import { DRAFT_QUANTITY, useInventoryWorld } from '../support/qa-payment-world.js';

const world = useInventoryWorld('qa_order_onay_yarisi');
const openCluster = useOrderClusters(world);

/**
 * order -> payment siniri genis: payment'ta kapida bekleyen onayin ARKASINDAN diger onay kosar;
 * sonuc kapiya bagli kalsin, saate degil (uyku yok).
 */
const GATED_PAYMENT_TIMEOUT_MS = 10_000;
const PAID = 'PAID';
const CLOSED = `${ERROR_CODES.THREEDS_FAILED}/0`;

const SETTLEMENT: Readonly<Partial<Record<OrderStatus, Settlement>>> = {
  [ORDER_STATUS.PAID]: {
    status: ORDER_STATUS.PAID,
    charged: 1,
    refunded: 0,
    onHandDelta: -DRAFT_QUANTITY,
    committed: true,
  },
  [ORDER_STATUS.PAYMENT_FAILED]: {
    status: ORDER_STATUS.PAYMENT_FAILED,
    charged: 0,
    refunded: 0,
    onHandDelta: 0,
    committed: false,
  },
};

type ConfirmResult = CallResult<orderV1.ConfirmPaymentResponse>;

interface Challenge {
  readonly cluster: OrderCluster;
  readonly orderId: string;
  readonly userId: string;
  readonly challengeId: string;
  /** Kilit icinde (onay oncesi) stok. */
  readonly before: StockState;
  /** Kopyadan onay; `code` verilmezse dogru kod. */
  confirm(copy: number, code?: string): Promise<ConfirmResult>;
}

/** Onay bekleyen siparis (taslak kopya 0'da, 3DS isteyen kartla siparis kopya 1'de). */
async function awaitingChallenge(): Promise<Challenge> {
  const cluster = await openCluster({ paymentTimeoutMs: GATED_PAYMENT_TIMEOUT_MS });
  const { orderId, userId, challengeId } = await openChallenge(cluster);
  return {
    cluster,
    orderId,
    userId,
    challengeId,
    before: await stockState(world, orderId),
    confirm: (copy, code) => cluster.copy(copy).calls.confirm(orderId, userId, challengeId, code),
  };
}

/** Kalan haklari `left`e indirir: sirayla yanlis kod, her biri kalan hakli ret. */
async function spendAttempts(challenge: Challenge, left: number): Promise<void> {
  for (let expected = 2; expected >= left; expected -= 1) {
    const wrong = await challenge.confirm(0, WRONG_CODE);
    expect(outcomeOf(wrong)).toBe(`${ERROR_CODES.THREEDS_FAILED}/${String(expected)}`);
  }
}

/**
 * `held` onayi payment'ta KAPIDA tutar, `meanwhile` o arada kosar; sonra kapi acilir ve tutulan
 * onayin sonucu doner. Tutulan onay payment'a ulasmadan biterse (order tarafi reddi) beklenmez,
 * o sonucla dusulur. Kapi her durumda acilir: kapanis kapida takilmaz.
 */
async function whileHeld(
  challenge: Challenge,
  held: () => Promise<ConfirmResult>,
  meanwhile: () => Promise<void>,
): Promise<ConfirmResult> {
  const hold = challenge.cluster.faults.holdBefore('confirm3Ds', challenge.orderId);
  const call = held();
  try {
    const early = await Promise.race([hold.arrived.then(() => undefined), call]);
    if (early !== undefined) {
      throw new Error(`tutulan onay payment'a ulasmadan bitti: ${outcomeOf(early)}`);
    }
    await meanwhile();
  } finally {
    hold.gate.open();
  }
  return call;
}

/** Onay cevabinin ozeti: 'PAID' ya da '<hata kodu>/<kalan hak>'. */
function outcomeOf(result: ConfirmResult): string {
  if (result.error !== undefined) {
    const error = appErrorOf(result.error);
    if (error === undefined) return `bilinmeyen hata: ${result.error.message}`;
    const details: unknown = error.details;
    const left =
      typeof details === 'object' && details !== null && 'attemptsLeft' in details
        ? String(details.attemptsLeft)
        : '-';
    return `${error.code}/${left}`;
  }
  return result.response?.status === orderV1.OrderStatus.ORDER_STATUS_PAID
    ? PAID
    : `durum ${String(result.response?.status)}`;
}

/** payment kaydinda kodu reddedilen deneme sayisi. */
async function rejectedCodes({ cluster, orderId }: Challenge): Promise<number> {
  const payment = await cluster.payments.findByOrderId(orderId);
  return attemptCount(payment, ATTEMPT_KIND.THREEDS, ATTEMPT_OUTCOME.CODE_REJECTED);
}

/** Para, stok, zaman cizelgesi, akis ve kurye kuyrugu: odeme TEK kez islendi. */
async function expectPaidOnce({ cluster, orderId, before }: Challenge): Promise<void> {
  await expectSettled(world, cluster, orderId, before, settlementOf(ORDER_STATUS.PAID));
  const order = await cluster.orders.findById(orderId);
  const paid = (order?.timeline ?? []).filter((entry) => entry.status === ORDER_STATUS.PAID);
  expect(paid).toHaveLength(1);
  // Kurye kuyruguna giris ani = tek PAID gecisinin ani (#92: once odeyen once kurye alir).
  expect(order?.courierQueuedAt).toEqual(paid[0]?.at);
  await expectStream(cluster, orderId, ORDER_STATUS.PAID);
}

/** Akista siparisin son gecisi `last`; PAID yalniz son durum PAID ise ve bir kez; komut yok. */
async function expectStream(cluster: OrderCluster, orderId: string, last: OrderStatus) {
  await cluster.copy(0).relay();
  const changes = statusChanges(cluster.stream, orderId);
  expect(changes.at(-1)?.to).toBe(last);
  const paid = changes.filter((change) => change.to === ORDER_STATUS.PAID).length;
  expect(paid).toBe(last === ORDER_STATUS.PAID ? 1 : 0);
  expect(eventCount(cluster.stream, orderId, EVENTS.PAYMENT_REFUND_REQUESTED)).toBe(0);
  expect(eventCount(cluster.stream, orderId, EVENTS.PAYMENT_CANCEL_REQUESTED)).toBe(0);
}

function settlementOf(status: OrderStatus | undefined): Settlement {
  const settlement = status === undefined ? undefined : SETTLEMENT[status];
  if (settlement === undefined) throw new Error(`beklenmeyen son durum: ${String(status)}`);
  return settlement;
}

describe('QA OQ3 ConfirmPayment yarislari (iki order kopyasi, gercek payment ve inventory)', () => {
  it('R1 ayni dogru kod iki kopyadan, payment ta bulusur: ikisi de PAID, para ve stok bir kez', async () => {
    const challenge = await awaitingChallenge();
    challenge.cluster.faults.barrier('confirm3Ds', challenge.orderId, 2);

    const [first, second] = await Promise.all([challenge.confirm(0), challenge.confirm(1)]);

    expect([outcomeOf(first), outcomeOf(second)]).toEqual([PAID, PAID]);
    expect(challenge.cluster.faults.calls('confirm3Ds', challenge.orderId)).toBe(2);
    await expectPaidOnce(challenge);
  });

  it('R2 ayni dogru kod; ikincisi payment ta ilki bitene kadar bekler: PAID, ikinci commit yok', async () => {
    const challenge = await awaitingChallenge();

    const late = await whileHeld(
      challenge,
      () => challenge.confirm(1),
      async () => {
        expect(outcomeOf(await challenge.confirm(0))).toBe(PAID);
      },
    );

    expect(outcomeOf(late)).toBe(PAID);
    expect(challenge.cluster.faults.calls('confirm3Ds', challenge.orderId)).toBe(2);
    await expectPaidOnce(challenge);
  });

  it('R3 dogru ve yanlis kod payment ta bulusur: PAID; yanlisin cevabi PAID ya da kalan hakli ret', async () => {
    const challenge = await awaitingChallenge();
    challenge.cluster.faults.barrier('confirm3Ds', challenge.orderId, 2);

    const [right, wrong] = await Promise.all([
      challenge.confirm(0),
      challenge.confirm(1, WRONG_CODE),
    ]);

    expect(outcomeOf(right)).toBe(PAID);
    expect([PAID, `${ERROR_CODES.THREEDS_FAILED}/2`]).toContain(outcomeOf(wrong));
    expect(challenge.cluster.faults.calls('confirm3Ds', challenge.orderId)).toBe(2);
    await expectPaidOnce(challenge);
  });

  it('R4 MEVCUT: yanlis kod payment ta bekler, dogru kod biter: yanlis kodun cevabi da PAID, hak dusmez', async () => {
    const challenge = await awaitingChallenge();

    const wrong = await whileHeld(
      challenge,
      () => challenge.confirm(1, WRONG_CODE),
      async () => {
        expect(outcomeOf(await challenge.confirm(0))).toBe(PAID);
      },
    );

    expect(outcomeOf(wrong)).toBe(PAID);
    expect(await rejectedCodes(challenge)).toBe(0);
    await expectPaidOnce(challenge);
  });

  it('R5 dogru kod payment ta bekler, yanlis kod biter: ret (kalan hak 2), siparis bekler; sonra PAID', async () => {
    const challenge = await awaitingChallenge();
    const { cluster, orderId } = challenge;

    const right = await whileHeld(
      challenge,
      () => challenge.confirm(0),
      async () => {
        const wrong = await challenge.confirm(1, WRONG_CODE);
        expect(outcomeOf(wrong)).toBe(`${ERROR_CODES.THREEDS_FAILED}/2`);
        expect((await cluster.orders.findById(orderId))?.status).toBe(
          ORDER_STATUS.AWAITING_PAYMENT,
        );
      },
    );

    expect(outcomeOf(right)).toBe(PAID);
    expect(await rejectedCodes(challenge)).toBe(1);
    await expectPaidOnce(challenge);
  });

  it('R6 son hak: dogru ve yanlis kod payment ta bulusur; sonuc PAID ya da PAYMENT_FAILED, tutarli', async () => {
    const challenge = await awaitingChallenge();
    const { cluster, orderId, before } = challenge;
    await spendAttempts(challenge, 1);
    cluster.faults.barrier('confirm3Ds', orderId, 2);

    const [right, wrong] = await Promise.all([
      challenge.confirm(0),
      challenge.confirm(1, WRONG_CODE),
    ]);

    expect([
      [PAID, PAID],
      [CLOSED, CLOSED],
    ]).toContainEqual([outcomeOf(right), outcomeOf(wrong)]);
    const status = (await cluster.orders.findById(orderId))?.status;
    expect(status).toBe(
      outcomeOf(right) === PAID ? ORDER_STATUS.PAID : ORDER_STATUS.PAYMENT_FAILED,
    );
    const settlement = settlementOf(status);
    await expectSettled(world, cluster, orderId, before, settlement);
    await expectStream(cluster, orderId, settlement.status);
  });

  it('R6a son hak, yanlis kod once islenir (dogru kod bekler): ikisi de ret, PAYMENT_FAILED, para 0', async () => {
    const challenge = await awaitingChallenge();
    const { cluster, orderId, before } = challenge;
    await spendAttempts(challenge, 1);

    const right = await whileHeld(
      challenge,
      () => challenge.confirm(0),
      async () => {
        expect(outcomeOf(await challenge.confirm(1, WRONG_CODE))).toBe(CLOSED);
      },
    );

    expect(outcomeOf(right)).toBe(CLOSED);
    await expectSettled(world, cluster, orderId, before, settlementOf(ORDER_STATUS.PAYMENT_FAILED));
    await expectStream(cluster, orderId, ORDER_STATUS.PAYMENT_FAILED);
    expect((await cluster.orders.findById(orderId))?.courierQueuedAt).toBeUndefined();
  });

  it('R6b son hak, dogru kod once islenir (yanlis kod bekler): ikisi de PAID, para ve stok bir kez', async () => {
    const challenge = await awaitingChallenge();
    await spendAttempts(challenge, 1);

    const wrong = await whileHeld(
      challenge,
      () => challenge.confirm(1, WRONG_CODE),
      async () => {
        expect(outcomeOf(await challenge.confirm(0))).toBe(PAID);
      },
    );

    expect(outcomeOf(wrong)).toBe(PAID);
    expect(await rejectedCodes(challenge)).toBe(2);
    await expectPaidOnce(challenge);
  });
});
