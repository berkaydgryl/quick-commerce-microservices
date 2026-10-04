/**
 * CreateOrder saga'si (T7.1), RISK adimi: bellek deposu, sahte risk ve odeme.
 * Odeme adiminin sonuclari ve telafi create-order-payment.spec.ts'te.
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
import { PAYMENT_METHOD } from '../../src/domain/checkout-payment.js';
import { transitionOrder } from '../../src/domain/order.js';
import { InMemoryOrderStore } from '../../src/infrastructure/memory/in-memory-order-store.js';
import { FakePayments, TEST_CARD } from '../support/fake-payments.js';
import { FakeStockReservations, TEST_LOCK_POLICY } from '../support/fake-stock-reservations.js';
import { FakeRiskAssessment } from '../support/fake-risk-assessment.js';
import { insertDraft, SAMPLE_PRICING } from '../support/order-builders.js';

const DRAFT_AT_MS = 1_760_000_000_000;
/** Taslak ile siparis arasi: checkout-dwell sinyali sunucuda olculur (B9). */
const DWELL_MS = 45_000;
const scope = { requestId: 'req_saga_1', logger: silentLogger };
const byCard = { method: PAYMENT_METHOD.CARD, cardToken: TEST_CARD.APPROVED } as const;
const cashOnDelivery = { method: PAYMENT_METHOD.CASH_ON_DELIVERY } as const;

let repository: InMemoryOrderStore;
let risk: FakeRiskAssessment;
let payments: FakePayments;
let stock: FakeStockReservations;
let create: ReturnType<typeof createCreateOrder>;

beforeEach(() => {
  repository = new InMemoryOrderStore();
  risk = new FakeRiskAssessment();
  payments = new FakePayments();
  stock = new FakeStockReservations();
  create = createCreateOrder({
    repository,
    history: repository,
    risk,
    payments,
    stock,
    outbox: repository,
    clock: fixedClock(DRAFT_AT_MS + DWELL_MS),
    lockPolicy: TEST_LOCK_POLICY,
  });
});

const draft = () => insertDraft(repository, fixedClock(DRAFT_AT_MS));

describe('CreateOrder - mutlu yol (LOW, kart)', () => {
  it('taslak odenmis siparis olur; tablo ADIM ADIM yurunur, bant kaydedilir', async () => {
    const { id } = await draft();

    const { order, challengeId } = await create({ orderId: id, userId: 'usr_1', ...byCard }, scope);

    expect(order.status).toBe(ORDER_STATUS.PAID);
    expect(challengeId).toBeUndefined();
    expect(order.timeline.map((entry) => [entry.status, entry.note])).toEqual([
      [ORDER_STATUS.DRAFT, undefined],
      [ORDER_STATUS.RISK_CHECK, undefined],
      // Stok taslakta kilitlendi (T11.2): RESERVED gercek kilit, not yok.
      [ORDER_STATUS.RESERVED, undefined],
      [ORDER_STATUS.AWAITING_PAYMENT, undefined],
      [ORDER_STATUS.PAID, undefined],
    ]);
    await expect(repository.findById(id)).resolves.toEqual(order);
    expect(order.riskBand).toBe(RISK_BANDS.LOW);
  });

  it('her gecis bir order.status_changed olayi; olaylar siparisle ayni yazimda (T7.3)', async () => {
    const { id } = await draft();

    await create({ orderId: id, userId: 'usr_1', ...byCard }, scope);

    expect(
      repository.recordedEvents
        .filter((event) => event.orderId === id)
        .map((event) => [event.topic, event.payload['to'], event.version]),
    ).toEqual([
      ['order.created', undefined, 1],
      ['order.status_changed', 'RISK_CHECK', 2],
      ['order.status_changed', 'RESERVED', 3],
      ['order.status_changed', 'AWAITING_PAYMENT', 4],
      ['order.status_changed', 'PAID', 5],
    ]);
  });

  it('cekim dondurulmus toplamla, siparisten turetilen anahtarla, 3DS zorunlu olmadan', async () => {
    const { id } = await draft();

    await create({ orderId: id, userId: 'usr_1', ...byCard }, scope);

    expect(payments.charges).toEqual([
      {
        orderId: id,
        userId: 'usr_1',
        amountMinor: SAMPLE_PRICING.totalMinor,
        currency: 'TRY',
        method: PAYMENT_METHOD.CARD,
        cardToken: TEST_CARD.APPROVED,
        idempotencyKey: `charge-${id}`,
        requireThreeDs: false,
      },
    ]);
  });

  it('risk baglami sunucudaki veriden: tutar, konum, gecmis ve olculen bekleme suresi', async () => {
    const { id } = await draft();

    await create({ orderId: id, userId: 'usr_1', ...byCard }, scope);

    expect(risk.contexts).toEqual([
      {
        userId: 'usr_1',
        orderId: id,
        marketId: 'mkt_migros-jet-moda',
        deliveredOrderCount: 0,
        cancelledOrderCount: 0,
        basketTotalMinor: SAMPLE_PRICING.totalMinor,
        currency: 'TRY',
        checkoutDwellMs: DWELL_MS,
        deliveryLocation: { lat: 40.9885, lng: 29.0262 },
        // Sinyal verilmedi (T7.5): bos nesne, hicbir kural tetiklenmez.
        signals: {},
      },
    ]);
  });

  it('LOW bantta kapida odeme acik: cekim yok, siparis PAID (not CASH_ON_DELIVERY)', async () => {
    const { id } = await draft();

    const { order } = await create({ orderId: id, userId: 'usr_1', ...cashOnDelivery }, scope);

    expect(order.status).toBe(ORDER_STATUS.PAID);
    expect(order.timeline.at(-1)?.note).toBe('CASH_ON_DELIVERY');
    // Kapida odeme de kurye kuyruguna odeme (PAID) aniyla girer (#92).
    expect(order.courierQueuedAt).toEqual(order.timeline.at(-1)?.at);
    await expect(repository.findById(id)).resolves.toMatchObject({
      courierQueuedAt: order.updatedAt,
    });
    expect(payments.charges[0]).toMatchObject({ method: 'CASH_ON_DELIVERY' });
    expect(payments.charges[0]).not.toHaveProperty('cardToken');
  });
});

describe('CreateOrder - bantlar', () => {
  it('MEDIUM: kart + 3DS zorunlu; siparis odeme bekler, challengeId doner', async () => {
    risk.band = RISK_BANDS.MEDIUM;
    const { id } = await draft();

    const { order, challengeId } = await create({ orderId: id, userId: 'usr_1', ...byCard }, scope);

    expect(payments.charges[0]?.requireThreeDs).toBe(true);
    expect(challengeId).toBe('tds_sahte_dogrulama');
    expect(order.status).toBe(ORDER_STATUS.AWAITING_PAYMENT);
    await expect(repository.findById(id)).resolves.toMatchObject({
      status: ORDER_STATUS.AWAITING_PAYMENT,
      riskBand: RISK_BANDS.MEDIUM,
    });
  });

  it('MEDIUM + kapida odeme: PAYMENT_METHOD_NOT_ALLOWED, siparis DRAFT kalir, cekim yok', async () => {
    risk.band = RISK_BANDS.MEDIUM;
    const original = await draft();

    const failing = create({ orderId: original.id, userId: 'usr_1', ...cashOnDelivery }, scope);

    await expect(failing).rejects.toMatchObject({
      code: ERROR_CODES.PAYMENT_METHOD_NOT_ALLOWED,
      details: { orderId: original.id, paymentMethod: 'CASH_ON_DELIVERY' },
    });
    await expect(repository.findById(original.id)).resolves.toEqual(original);
    expect(payments.charges).toEqual([]);
    // Siparis degismedi: yalnizca taslagin order.created'i var, gecis olayi yok.
    expect(repository.recordedEvents.map((event) => event.topic)).toEqual(['order.created']);
  });

  it.each([
    [RISK_BANDS.HIGH, ORDER_STATUS.REVIEW, ERROR_CODES.RISK_REVIEW],
    [RISK_BANDS.CRITICAL, ORDER_STATUS.REJECTED, ERROR_CODES.RISK_BLOCKED],
  ])('%s: siparis %s yazilir, %s doner, odeme alinmaz', async (band, status, code) => {
    risk.band = band;
    const { id } = await draft();

    const failing = create({ orderId: id, userId: 'usr_1', ...byCard }, scope);

    await expect(failing).rejects.toMatchObject({ code, details: { orderId: id, status } });
    const stored = await repository.findById(id);
    expect(stored?.timeline.map((entry) => [entry.status, entry.note])).toEqual([
      [ORDER_STATUS.DRAFT, undefined],
      [ORDER_STATUS.RISK_CHECK, undefined],
      [status, code],
    ]);
    expect(stored?.riskBand).toBe(band);
    expect(payments.charges).toEqual([]);
  });
});

describe('CreateOrder - on kosullar', () => {
  it('risk servisine ulasilamazsa HICBIR SEY yazilmaz: riski atlayarak odeme alinmaz', async () => {
    risk.failure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'risk kapali');
    const original = await draft();

    await expect(
      create({ orderId: original.id, userId: 'usr_1', ...byCard }, scope),
    ).rejects.toMatchObject({ code: ERROR_CODES.SERVICE_UNAVAILABLE });
    await expect(repository.findById(original.id)).resolves.toEqual(original);
    expect(payments.charges).toEqual([]);
  });

  it.each([
    ['olmayan siparis', 'ord_yok', 'usr_1'],
    ['baskasinin siparisi (varlik bilgisi sizmasin)', undefined, 'usr_2'],
  ])('%s: NOT_FOUND, risk sorulmaz', async (_name, orderId, userId) => {
    const { id } = await draft();

    await expect(
      create({ orderId: orderId ?? id, userId, ...byCard }, scope),
    ).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
    expect(risk.contexts).toEqual([]);
  });

  it('odenmis siparis ikinci kez olusturulamaz: ORDER_STATE_INVALID, risk sorulmaz', async () => {
    const { id } = await draft();
    await create({ orderId: id, userId: 'usr_1', ...byCard }, scope);

    await expect(create({ orderId: id, userId: 'usr_1', ...byCard }, scope)).rejects.toMatchObject({
      code: ERROR_CODES.ORDER_STATE_INVALID,
    });
    expect(risk.contexts).toHaveLength(1);
    expect(payments.charges).toHaveLength(1);
  });

  it('iptal edilmis taslak: ORDER_STATE_INVALID', async () => {
    const original = await draft();
    const cancelled = transitionOrder(original, ORDER_STATUS.CANCELLED, fixedClock(DRAFT_AT_MS));
    await repository.update(cancelled, original.version, []);

    await expect(
      create({ orderId: original.id, userId: 'usr_1', ...byCard }, scope),
    ).rejects.toMatchObject({ code: ERROR_CODES.ORDER_STATE_INVALID });
    expect(risk.contexts).toEqual([]);
  });
});
