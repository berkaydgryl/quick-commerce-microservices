/**
 * ConfirmPayment (T7.1): 3DS kodunu payment-svc'ye iletir, sonucu siparise isler.
 * Bellek deposu ve sahte odeme; ag yok.
 */

import {
  AppError,
  ERROR_CODES,
  fixedClock,
  MOCK_THREEDS_CODE,
  ORDER_STATUS,
  RISK_BANDS,
  silentLogger,
} from '@getir/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { createConfirmPayment } from '../../src/application/confirm-payment.js';
import { transitionOrder } from '../../src/domain/order.js';
import { InMemoryOrderStore } from '../../src/infrastructure/memory/in-memory-order-store.js';
import { FAKE_CHALLENGE_ID, FakePayments } from '../support/fake-payments.js';
import { FakeStockReservations, TEST_LOCK_POLICY } from '../support/fake-stock-reservations.js';
import { insertAwaitingPayment, insertDraft } from '../support/order-builders.js';

const clock = fixedClock(1_760_000_000_000);
const scope = { requestId: 'req_3ds_1', logger: silentLogger };

let repository: InMemoryOrderStore;
let payments: FakePayments;
let stock: FakeStockReservations;
let confirm: ReturnType<typeof createConfirmPayment>;

beforeEach(() => {
  repository = new InMemoryOrderStore();
  payments = new FakePayments();
  stock = new FakeStockReservations();
  confirm = createConfirmPayment({
    repository,
    payments,
    stock,
    outbox: repository,
    clock,
    lockPolicy: TEST_LOCK_POLICY,
  });
});

/** 3DS bekleyen (MEDIUM bant) siparis. */
const awaiting3Ds = () => insertAwaitingPayment(repository, clock, RISK_BANDS.MEDIUM);

const input = (orderId: string, code = MOCK_THREEDS_CODE) => ({
  orderId,
  userId: 'usr_1',
  challengeId: FAKE_CHALLENGE_ID,
  code,
});

function threeDsFailed(attemptsLeft: number, reason: string): AppError {
  return new AppError(ERROR_CODES.THREEDS_FAILED, '3DS dogrulamasi basarisiz', {
    details: { attemptsLeft, reason },
  });
}

describe('ConfirmPayment', () => {
  it('dogru kod: siparis PAID; kod ve jeton payment-svc ye aynen iletilir', async () => {
    const { id } = await awaiting3Ds();

    const order = await confirm(input(id), scope);

    expect(order.status).toBe(ORDER_STATUS.PAID);
    await expect(repository.findById(id)).resolves.toMatchObject({ status: ORDER_STATUS.PAID });
    expect(payments.confirmations).toEqual([
      { orderId: id, challengeId: FAKE_CHALLENGE_ID, code: MOCK_THREEDS_CODE },
    ]);
  });

  it('yanlis kod, hak var: THREEDS_FAILED (kalan hak ayrintida), siparis odeme bekler', async () => {
    const { id } = await awaiting3Ds();
    payments.confirmOutcome = threeDsFailed(2, 'wrong_code');

    await expect(confirm(input(id, '000000'), scope)).rejects.toMatchObject({
      code: ERROR_CODES.THREEDS_FAILED,
      details: { attemptsLeft: 2, reason: 'wrong_code' },
    });
    await expect(repository.findById(id)).resolves.toMatchObject({
      status: ORDER_STATUS.AWAITING_PAYMENT,
    });
  });

  it.each(['attempts_exhausted', 'expired'])(
    'dogrulama kapandi (%s): siparis PAYMENT_FAILED, istemci payment-svc nin hatasini aynen gorur',
    async (reason) => {
      const { id } = await awaiting3Ds();
      payments.confirmOutcome = threeDsFailed(0, reason);

      await expect(confirm(input(id, '000000'), scope)).rejects.toMatchObject({
        code: ERROR_CODES.THREEDS_FAILED,
        details: { attemptsLeft: 0, reason },
      });
      const order = await repository.findById(id);
      expect(order?.status).toBe(ORDER_STATUS.PAYMENT_FAILED);
      expect(order?.timeline.at(-1)?.note).toBe('THREEDS_FAILED');
    },
  );

  it('dogru kod: stok kilidi PAID yazilmadan once kesinlesir (T11.2)', async () => {
    const { id, marketId } = await awaiting3Ds();

    await confirm(input(id), scope);

    expect(stock.commits).toEqual([{ orderId: id, marketId }]);
    expect(stock.releases).toEqual([]);
  });

  it('dogrulama kapandi: siparis PAYMENT_FAILED, kilit birakilir (payment_failed)', async () => {
    const { id, marketId } = await awaiting3Ds();
    payments.confirmOutcome = threeDsFailed(0, 'attempts_exhausted');

    await expect(confirm(input(id, '000000'), scope)).rejects.toBeInstanceOf(AppError);

    expect(stock.releases).toEqual([{ orderId: id, marketId, reason: 'payment_failed' }]);
    expect(stock.commits).toEqual([]);
  });

  it('yanlis kod, hak var: kilit KORUNUR (kullanici yeniden dener)', async () => {
    const { id } = await awaiting3Ds();
    payments.confirmOutcome = threeDsFailed(2, 'wrong_code');

    await expect(confirm(input(id, '000000'), scope)).rejects.toBeInstanceOf(AppError);

    expect(stock.releases).toEqual([]);
  });

  it('3DS beklerken kilit dustu: tutar iade edilir, siparis CANCELLED, RESERVATION_EXPIRED', async () => {
    const { id } = await awaiting3Ds();
    stock.expire(id);

    await expect(confirm(input(id), scope)).rejects.toMatchObject({
      code: ERROR_CODES.RESERVATION_EXPIRED,
      details: { orderId: id, status: ORDER_STATUS.CANCELLED },
    });
    expect(payments.refunds.map((refund) => [refund.orderId, refund.reason])).toEqual([
      [id, 'reservation_expired'],
    ]);
    await expect(repository.findById(id)).resolves.toMatchObject({
      status: ORDER_STATUS.CANCELLED,
    });
  });

  it('tekrar istek (onay cevabi kayboldu): siparis zaten PAID, payment-svc ye gidilmez', async () => {
    const { id } = await awaiting3Ds();
    const first = await confirm(input(id), scope);

    await expect(confirm(input(id), scope)).resolves.toEqual(first);
    expect(payments.confirmations).toHaveLength(1);
  });

  it('odeme beklemeyen siparis: ORDER_STATE_INVALID, payment-svc ye gidilmez', async () => {
    const { id } = await insertDraft(repository, clock);

    await expect(confirm(input(id), scope)).rejects.toMatchObject({
      code: ERROR_CODES.ORDER_STATE_INVALID,
    });
    expect(payments.confirmations).toEqual([]);
  });

  it('baskasinin siparisi NOT_FOUND', async () => {
    const { id } = await awaiting3Ds();

    await expect(confirm({ ...input(id), userId: 'usr_2' }, scope)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
  });

  it('onay basarili ama siparis ayni anda iptal edildi: tutar iade edilir, CONFLICT', async () => {
    const awaiting = await awaiting3Ds();
    // payment-svc'den cevap beklenirken kullanici iptal eder.
    payments.confirmOutcome = { status: 'SUCCEEDED' };
    const original = payments.confirmThreeDs.bind(payments);
    payments.confirmThreeDs = async (request) => {
      await repository.update(
        transitionOrder(awaiting, ORDER_STATUS.CANCELLED, clock, 'USER_CANCELLED'),
        awaiting.version,
        [],
      );
      return original(request);
    };

    await expect(confirm(input(awaiting.id), scope)).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
    });
    expect(payments.refunds.map((refund) => refund.orderId)).toEqual([awaiting.id]);
  });
});
