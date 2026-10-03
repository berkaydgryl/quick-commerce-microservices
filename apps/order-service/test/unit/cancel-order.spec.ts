/**
 * Use-case: kullanici iptali (B29). Bellek deposu, sabit saat.
 */

import { AppError, ERROR_CODES, fixedClock, ORDER_STATUS, silentLogger } from '@getir/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { createCancelOrder } from '../../src/application/cancel-order.js';
import { PAYMENT_METHOD, PAYMENT_STATUS } from '../../src/domain/checkout-payment.js';
import { transitionOrder } from '../../src/domain/order.js';
import { InMemoryOrderStore } from '../../src/infrastructure/memory/in-memory-order-store.js';
import { FakePayments } from '../support/fake-payments.js';
import { FakeStockReservations } from '../support/fake-stock-reservations.js';
import { insertAwaitingPayment, insertDraft } from '../support/order-builders.js';

const clock = fixedClock(1_760_000_000_000);
const scope = { requestId: 'req_iptal_1', logger: silentLogger };

let repository: InMemoryOrderStore;
let stock: FakeStockReservations;
let payments: FakePayments;
let cancel: ReturnType<typeof createCancelOrder>;

beforeEach(() => {
  repository = new InMemoryOrderStore();
  stock = new FakeStockReservations();
  payments = new FakePayments();
  cancel = createCancelOrder({ repository, payments, stock, clock });
});

describe('cancelOrder use-case', () => {
  it('DRAFT siparisi iptal eder; gerekce yoksa CART_RELEASED yazar (sepeti birakmak, T11.4)', async () => {
    const { id } = await insertDraft(repository, clock);

    const order = await cancel({ orderId: id, userId: 'usr_1' }, scope);

    expect(order.status).toBe(ORDER_STATUS.CANCELLED);
    expect(order.timeline.at(-1)).toEqual({
      status: ORDER_STATUS.CANCELLED,
      at: clock.date(),
      note: 'CART_RELEASED',
    });
    await expect(repository.findById(id)).resolves.toMatchObject({
      status: ORDER_STATUS.CANCELLED,
    });
  });

  it('odeme bekleyen siparis gerekcesiz iptal edilirse USER_CANCELLED (risk gecmisinde sayilir)', async () => {
    const { id } = await insertAwaitingPayment(repository, clock);

    const order = await cancel({ orderId: id, userId: 'usr_1' }, scope);

    expect(order.timeline.at(-1)?.note).toBe('USER_CANCELLED');
  });

  it('taslak gerekceyle iptal edilirse gerekce yazilir (CART_RELEASED yalnizca gerekcesizde)', async () => {
    const { id } = await insertDraft(repository, clock);

    const order = await cancel({ orderId: id, userId: 'usr_1', reason: 'CHANGED_MIND' }, scope);

    expect(order.timeline.at(-1)?.note).toBe('CHANGED_MIND');
  });

  it('odeme bekleyen siparisi verilen gerekceyle iptal eder', async () => {
    const { id } = await insertAwaitingPayment(repository, clock);

    const order = await cancel({ orderId: id, userId: 'usr_1', reason: 'CHANGED_MIND' }, scope);

    expect(order.timeline.at(-1)?.note).toBe('CHANGED_MIND');
    // Iptal de bir gecistir: olayi gerekcesiyle yazilir (T7.3). Odeme asamasindan
    // iptal oldugu icin ayni yazimda payment'a iptal komutu da gider (T11.2 PR 3).
    expect(repository.recordedEvents.slice(-2)).toMatchObject([
      {
        topic: 'order.status_changed',
        orderId: id,
        payload: { from: 'AWAITING_PAYMENT', to: 'CANCELLED', note: 'CHANGED_MIND' },
      },
      {
        topic: 'payment.cancel_requested',
        orderId: id,
        payload: { orderId: id, reason: 'order_cancelled' },
      },
    ]);
  });

  it('odenmis siparisi kullanici iptal EDEMEZ (iade sistemin telafi adimi, B20c)', async () => {
    const awaiting = await insertAwaitingPayment(repository, clock);
    const { id } = awaiting;
    await repository.update(
      transitionOrder(awaiting, ORDER_STATUS.PAID, clock),
      awaiting.version,
      [],
    );

    const failing = cancel({ orderId: id, userId: 'usr_1' }, scope);

    await expect(failing).rejects.toBeInstanceOf(AppError);
    await expect(failing).rejects.toMatchObject({
      code: ERROR_CODES.ORDER_STATE_INVALID,
      details: { orderId: id, status: ORDER_STATUS.PAID },
    });
    await expect(repository.findById(id)).resolves.toMatchObject({ status: ORDER_STATUS.PAID });
  });

  it('iptal edilmis siparis ikinci kez iptal edilemez', async () => {
    const { id } = await insertDraft(repository, clock);
    await cancel({ orderId: id, userId: 'usr_1' }, scope);

    // Ayrintidaki status CANCELLED: gateway bunu "zaten birakilmis" sayar (T11.4).
    await expect(cancel({ orderId: id, userId: 'usr_1' }, scope)).rejects.toMatchObject({
      code: ERROR_CODES.ORDER_STATE_INVALID,
      details: { orderId: id, status: ORDER_STATUS.CANCELLED },
    });
  });

  it.each([
    ['taslak', 'cart_released', () => insertDraft(repository, clock)],
    ['odeme bekleyen', 'user_cancelled', () => insertAwaitingPayment(repository, clock)],
  ])(
    '%s siparisin stok kilidi iptalden SONRA birakilir (%s; T11.2, T11.4)',
    async (_name, reason, given) => {
      const { id, marketId } = await given();

      await cancel({ orderId: id, userId: 'usr_1' }, scope);

      expect(stock.releases).toEqual([{ orderId: id, marketId, reason }]);
    },
  );

  it('kilit birakilamazsa iptal yine basarili (kilit suresi dolunca inventory geri verir)', async () => {
    stock.releaseFailure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'inventory yok');
    const { id } = await insertDraft(repository, clock);

    const order = await cancel({ orderId: id, userId: 'usr_1' }, scope);

    expect(order.status).toBe(ORDER_STATUS.CANCELLED);
    expect(stock.releases).toHaveLength(1);
  });

  it("kilidi olmayan eski taslakta (T11.2 oncesi) inventory'ye gidilmez", async () => {
    const { id } = await insertDraft(repository, clock, {}, { reservation: null });

    await cancel({ orderId: id, userId: 'usr_1' }, scope);

    expect(stock.releases).toEqual([]);
  });

  it('iptal reddedilirse (odenmis siparis) kilide dokunulmaz', async () => {
    const draft = await insertDraft(repository, clock);
    const paid = [
      ORDER_STATUS.RISK_CHECK,
      ORDER_STATUS.RESERVED,
      ORDER_STATUS.AWAITING_PAYMENT,
      ORDER_STATUS.PAID,
    ].reduce((order, status) => transitionOrder(order, status, clock), draft);
    await repository.update(paid, draft.version, []);

    await expect(cancel({ orderId: draft.id, userId: 'usr_1' }, scope)).rejects.toBeInstanceOf(
      AppError,
    );
    expect(stock.releases).toEqual([]);
  });

  it.each([
    ['para alinmis', PAYMENT_STATUS.SUCCEEDED],
    ['kart cekimi suruyor', PAYMENT_STATUS.PENDING],
  ])(
    'odeme bekleyen siparis, %s: iptal EDILMEZ (REQUEST_IN_PROGRESS); siparis ve kilit degismez (T11.2 PR 2)',
    async (_name, status) => {
      const awaiting = await insertAwaitingPayment(repository, clock);
      payments.payments.set(awaiting.id, { status, method: PAYMENT_METHOD.CARD });

      await expect(cancel({ orderId: awaiting.id, userId: 'usr_1' }, scope)).rejects.toMatchObject({
        code: ERROR_CODES.REQUEST_IN_PROGRESS,
        details: { orderId: awaiting.id, paymentStatus: status },
      });
      await expect(repository.findById(awaiting.id)).resolves.toEqual(awaiting);
      expect(stock.releases).toEqual([]);
    },
  );

  it.each([
    ['3DS bekliyor', PAYMENT_STATUS.REQUIRES_3DS, PAYMENT_METHOD.CARD],
    ['kart reddedildi', PAYMENT_STATUS.FAILED, PAYMENT_METHOD.CARD],
    ['kapida odeme (tutar teslimatta)', PAYMENT_STATUS.PENDING, PAYMENT_METHOD.CASH_ON_DELIVERY],
  ])('odeme bekleyen siparis, para alinmamis (%s): iptal edilir', async (_name, status, method) => {
    const awaiting = await insertAwaitingPayment(repository, clock);
    payments.payments.set(awaiting.id, { status, method });

    const order = await cancel({ orderId: awaiting.id, userId: 'usr_1' }, scope);

    expect(order.status).toBe(ORDER_STATUS.CANCELLED);
  });

  it('payment-svc kapali: odeme bekleyen siparis iptal EDILMEZ (SERVICE_UNAVAILABLE)', async () => {
    const awaiting = await insertAwaitingPayment(repository, clock);
    payments.getPaymentFailure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'payment kapali');

    await expect(cancel({ orderId: awaiting.id, userId: 'usr_1' }, scope)).rejects.toMatchObject({
      code: ERROR_CODES.SERVICE_UNAVAILABLE,
    });
    await expect(repository.findById(awaiting.id)).resolves.toEqual(awaiting);
  });

  it('taslakta odeme sorulmaz (cekim olamaz)', async () => {
    const { id } = await insertDraft(repository, clock);

    await cancel({ orderId: id, userId: 'usr_1' }, scope);

    expect(payments.lookups).toEqual([]);
  });

  it('baskasinin siparisi NOT_FOUND (varlik bilgisi sizmasin)', async () => {
    const { id } = await insertDraft(repository, clock);

    await expect(cancel({ orderId: id, userId: 'usr_2' }, scope)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
    await expect(repository.findById(id)).resolves.toMatchObject({ status: ORDER_STATUS.DRAFT });
  });
});
