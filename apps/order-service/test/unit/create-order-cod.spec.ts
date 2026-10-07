/**
 * CreateOrder, kapida odeme (T12.4): nakit ya da kapida POS. Tur risk adiminin
 * yaziminda siparise girer. Orta bantta kapida odeme kapali; siparis taslakta
 * kalir ve ayni siparis kartla verilebilir. Odeme bekleyen sipariste yontem ya
 * da tur degisirse CONFLICT (cekimi degistirir).
 */

import {
  AppError,
  ERROR_CODES,
  fixedClock,
  ORDER_STATUS,
  RISK_BANDS,
  silentLogger,
} from '@getir/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { createCreateOrder } from '../../src/application/create-order.js';
import type { CreateOrderInput } from '../../src/application/create-order.js';
import { PAYMENT_METHOD } from '../../src/domain/checkout-payment.js';
import { DELIVERY_PAYMENT_KIND } from '../../src/domain/order-payment.js';
import type { DeliveryPaymentKind } from '../../src/domain/order-payment.js';
import { TIMELINE_NOTE } from '../../src/domain/order.js';
import type { Order } from '../../src/domain/order.js';
import { InMemoryOrderStore } from '../../src/infrastructure/memory/in-memory-order-store.js';
import { FakePayments, TEST_CARD } from '../support/fake-payments.js';
import { FakeRiskAssessment } from '../support/fake-risk-assessment.js';
import { FakeStockReservations, TEST_LOCK_POLICY } from '../support/fake-stock-reservations.js';
import { insertDraft } from '../support/order-builders.js';

const START_MS = 1_760_000_000_000;
const clock = fixedClock(START_MS);
const scope = { requestId: 'req_kapida_1', logger: silentLogger };

let repository: InMemoryOrderStore;
let risk: FakeRiskAssessment;
let payments: FakePayments;
let stock: FakeStockReservations;
let create: ReturnType<typeof createCreateOrder>;

beforeEach(() => {
  clock.set(START_MS);
  repository = new InMemoryOrderStore();
  risk = new FakeRiskAssessment();
  payments = new FakePayments();
  stock = new FakeStockReservations(() => clock.now());
  create = createCreateOrder({
    repository,
    history: repository,
    risk,
    payments,
    stock,
    outbox: repository,
    clock,
    lockPolicy: TEST_LOCK_POLICY,
  });
});

const onDelivery = (orderId: string, kind: DeliveryPaymentKind): CreateOrderInput => ({
  orderId,
  userId: 'usr_1',
  method: PAYMENT_METHOD.CASH_ON_DELIVERY,
  onDelivery: kind,
});

const byCard = (orderId: string): CreateOrderInput => ({
  orderId,
  userId: 'usr_1',
  method: PAYMENT_METHOD.CARD,
  cardToken: TEST_CARD.APPROVED,
});

async function stored(orderId: string): Promise<Order> {
  const order = await repository.findById(orderId);
  if (order === null) throw new Error(`siparis yok: ${orderId}`);
  return order;
}

describe('CreateOrder kapida odeme (T12.4)', () => {
  it.each([DELIVERY_PAYMENT_KIND.CASH, DELIVERY_PAYMENT_KIND.POS])(
    'LOW bant, %s: cekim yok, PAID; secim siparise yazilir',
    async (kind) => {
      const { id } = await insertDraft(repository, clock);

      const { order } = await create(onDelivery(id, kind), scope);

      expect(order.status).toBe(ORDER_STATUS.PAID);
      expect(order.timeline.at(-1)?.note).toBe(TIMELINE_NOTE.CASH_ON_DELIVERY);
      expect((await stored(id)).payment).toEqual({
        method: PAYMENT_METHOD.CASH_ON_DELIVERY,
        onDelivery: kind,
      });
      // Tur odeme servisine gitmez: payment-svc kapida odemeyi tur bilmeden PENDING tutar.
      expect(payments.charges[0]).not.toHaveProperty('onDelivery');
    },
  );

  it('kartla odeme: secim yalnizca yontem (tur yok)', async () => {
    const { id } = await insertDraft(repository, clock);

    await create(byCard(id), scope);

    expect((await stored(id)).payment).toEqual({ method: PAYMENT_METHOD.CARD });
  });

  it('MEDIUM bant: kapida odeme PAYMENT_METHOD_NOT_ALLOWED; siparis taslakta, secim yazilmaz; kartla yeniden verilir', async () => {
    risk.band = RISK_BANDS.MEDIUM;
    const { id } = await insertDraft(repository, clock);

    await expect(create(onDelivery(id, DELIVERY_PAYMENT_KIND.POS), scope)).rejects.toMatchObject({
      code: ERROR_CODES.PAYMENT_METHOD_NOT_ALLOWED,
    });
    const draft = await stored(id);
    expect(draft.status).toBe(ORDER_STATUS.DRAFT);
    expect(draft).not.toHaveProperty('payment');

    const { order, challengeId } = await create(byCard(id), scope);

    expect(order.status).toBe(ORDER_STATUS.AWAITING_PAYMENT);
    expect(challengeId).toBeDefined();
    expect((await stored(id)).payment).toEqual({ method: PAYMENT_METHOD.CARD });
  });

  it('odeme bekleyen sipariste tur degisirse CONFLICT (alan onDelivery); ayni turle tamamlanir', async () => {
    const { id } = await insertDraft(repository, clock);
    payments.chargeFailure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'payment kapali');
    await create(onDelivery(id, DELIVERY_PAYMENT_KIND.CASH), scope).catch(() => undefined);
    payments.chargeFailure = undefined;
    expect((await stored(id)).status).toBe(ORDER_STATUS.AWAITING_PAYMENT);

    await expect(create(onDelivery(id, DELIVERY_PAYMENT_KIND.POS), scope)).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
      details: { orderId: id, field: 'onDelivery' },
    });
    await expect(create(byCard(id), scope)).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
      details: { orderId: id, field: 'paymentMethod' },
    });
    expect(payments.charges).toHaveLength(1);

    const { order } = await create(onDelivery(id, DELIVERY_PAYMENT_KIND.CASH), scope);
    expect(order.status).toBe(ORDER_STATUS.PAID);
    expect(order.payment).toEqual({ method: PAYMENT_METHOD.CASH_ON_DELIVERY, onDelivery: 'CASH' });
  });

  it('kilidi dusmus odeme bekleyen siparis: yontem degisse de once dusus kurali (410), CONFLICT degil', async () => {
    const { id } = await insertDraft(repository, clock);
    payments.chargeFailure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'payment kapali');
    await create(byCard(id), scope).catch(() => undefined);
    payments.chargeFailure = undefined;
    const awaiting = await stored(id);
    expect(awaiting.payment).toEqual({ method: PAYMENT_METHOD.CARD });
    clock.set((awaiting.reservation?.expiresAt.getTime() ?? 0) - 30_000);
    stock.expire(id);

    await expect(create(onDelivery(id, DELIVERY_PAYMENT_KIND.CASH), scope)).rejects.toMatchObject({
      code: ERROR_CODES.RESERVATION_EXPIRED,
    });
    expect((await stored(id)).status).toBe(ORDER_STATUS.CANCELLED);
  });

  it('kilit inventory tarafinda uzatilirsa (kayit eskimis gorunse de) yontem degisimi CONFLICT; kapida odemeyle CEKILMEZ', async () => {
    const { id } = await insertDraft(repository, clock);
    payments.chargeFailure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'payment kapali');
    await create(byCard(id), scope).catch(() => undefined);
    payments.chargeFailure = undefined;
    const awaiting = await stored(id);
    // Kalan sure pencerenin altinda: odeme adimi kilidi uzatir (dusmus degil).
    clock.set((awaiting.reservation?.expiresAt.getTime() ?? 0) - 30_000);

    await expect(create(onDelivery(id, DELIVERY_PAYMENT_KIND.CASH), scope)).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
      details: { orderId: id, field: 'paymentMethod' },
    });
    expect(payments.charges.map((charge) => charge.method)).toEqual([PAYMENT_METHOD.CARD]);
    expect((await stored(id)).status).toBe(ORDER_STATUS.AWAITING_PAYMENT);
  });

  it('durdurulan sipariste (REVIEW) secim yazilmaz: bant politikasi denetlenmedi', async () => {
    risk.band = RISK_BANDS.HIGH;
    const { id } = await insertDraft(repository, clock);

    await expect(create(onDelivery(id, DELIVERY_PAYMENT_KIND.CASH), scope)).rejects.toMatchObject({
      code: ERROR_CODES.RISK_REVIEW,
    });

    const review = await stored(id);
    expect(review.status).toBe(ORDER_STATUS.REVIEW);
    expect(review).not.toHaveProperty('payment');
  });
});
