/**
 * CreateOrder uctan uca, kayitli kart ve siparis ayrintilari (T12.4; B1/B2):
 * GERCEK order gRPC sunucusu, GERCEK payment-svc ve kart kasasi (ayni kart
 * deposu), order'in GrpcPayments istemcisi. Risk, catalog ve stok sahte.
 *
 * Kart NOT_FOUND telden aynen gecer, siparis odeme bekler, ayni siparis baska
 * kartla odenir. Ayrinti yalnizca GetOrder'da doner (liste ve gecmis yok).
 * Kisisel veri (adlar, telefon, not, hediye mesaji) iki servisin de gunlugune,
 * hata cevabina ve olaylara (outbox) girmez - hata yolu dahil.
 */

import { ERROR_CODES, fixedClock, GRPC_STATUS, RISK_BANDS } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { cardvaultV1, orderV1 } from '@getir/proto';
import { appErrorOf, startTestGrpcServer } from '@getir/service-kit/testing';
import type { TestGrpcServer, UnaryCall } from '@getir/service-kit/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildCardVaultService,
  buildPaymentService,
} from '../../../../payment-service/src/bootstrap.js';
import { THREEDS_CHALLENGE_TTL_MS } from '../../../../payment-service/src/config/constants.js';
import { InMemoryCardStore } from '../../../../payment-service/src/infrastructure/memory/in-memory-card-store.js';
import { InMemoryPaymentStore } from '../../../../payment-service/src/infrastructure/memory/in-memory-payment-store.js';
import { buildOrderService } from '../../../src/bootstrap.js';
import { InMemoryOrderStore } from '../../../src/infrastructure/memory/in-memory-order-store.js';
import { GrpcPayments } from '../../../src/infrastructure/payment/grpc-payments.js';
import { FakeCatalogPricing } from '../../support/fake-catalog-pricing.js';
import { FakeRiskAssessment } from '../../support/fake-risk-assessment.js';
import { FakeStockReservations } from '../../support/fake-stock-reservations.js';
import { FUNCTIONAL_TIMEOUT_MS } from '../../support/held-replies.js';
import { createOrderRequest, draftRequest, ORDER_DETAILS } from '../../support/order-fixtures.js';
import { newDraftId } from '../../support/order-grpc-harness.js';

const clock = fixedClock(Date.parse('2026-10-07T12:00:00Z'));
const Orders = orderV1.OrderServiceService;
const MISSING_CARD = `crd_${'0'.repeat(32)}`;
const GIFT: orderV1.GiftDetails = {
  message: 'Doğum günün kutlu olsun',
  senderName: 'Ayşe Demir',
  recipientName: 'Zeynep Kaya',
  recipientPhone: '+905321112233',
};
const DETAILS: orderV1.OrderDetails = {
  gift: GIFT,
  note: 'Zile basma, bebek uyuyor',
  doNotRingBell: true,
  agreementsAccepted: true,
};
const OTHER_DETAILS: orderV1.OrderDetails = {
  ...ORDER_DETAILS,
  note: 'Kapıcıya bırak lütfen',
};
/** Hicbir gunluk satirinda, hata cevabinda ya da olayda gorunmemesi gerekenler. */
const PERSONAL = [
  GIFT.message,
  GIFT.senderName,
  GIFT.recipientName,
  GIFT.recipientPhone,
  DETAILS.note,
  OTHER_DETAILS.note,
];

const lines: LogLine[] = [];
const risk = new FakeRiskAssessment();
const orders = new InMemoryOrderStore();
const paymentRecords = new InMemoryPaymentStore();
let paymentServer: TestGrpcServer;
let orderServer: TestGrpcServer;
let payments: GrpcPayments;

beforeAll(async () => {
  const cards = new InMemoryCardStore();
  paymentServer = await startTestGrpcServer({
    serviceName: 'payment-ayrinti',
    logger: recordingLogger(lines, { side: 'payment' }),
    services: [
      buildPaymentService({
        cards,
        repository: paymentRecords,
        clock,
        logger: recordingLogger(lines, { side: 'payment' }),
      }),
      buildCardVaultService({ repository: cards, clock }),
    ],
  });
  payments = new GrpcPayments(`127.0.0.1:${paymentServer.handle.port}`, FUNCTIONAL_TIMEOUT_MS);
  orderServer = await startTestGrpcServer({
    serviceName: 'order-ayrinti',
    logger: recordingLogger(lines, { side: 'order' }),
    services: [
      buildOrderService({
        catalog: new FakeCatalogPricing(),
        risk,
        payments,
        stock: new FakeStockReservations(() => clock.now()),
        store: { repository: orders, history: orders, outbox: orders },
        logger: recordingLogger(lines, { side: 'order' }),
        clock,
      }),
    ],
  });
});

afterAll(async () => {
  await orderServer?.stop();
  payments?.close();
  await paymentServer?.stop();
});

const call: UnaryCall = (method, request, metadata) => orderServer.call(method, request, metadata);

async function savedCard(userId: string): Promise<string> {
  const { response } = await paymentServer.call(cardvaultV1.CardVaultServiceService.addCard, {
    userId,
    number: '4242 4242 4242 4242',
    expiryMonth: 12,
    expiryYear: 2031,
    cvv: '987',
    holderName: 'Kart Sahibi',
    nickname: '',
  });
  return response?.card?.id ?? '';
}

/** Kullanicinin taslagi + kayitli kartla CreateOrder (kart verilmezse kasada olmayan kart). */
async function orderWith(userId: string, cardId = MISSING_CARD, details = DETAILS) {
  const orderId = await newDraftId(call, { ...draftRequest, userId });
  const result = await call(Orders.createOrder, byCard(orderId, userId, cardId, details));
  return { orderId, ...result };
}

const byCard = (orderId: string, userId: string, cardId: string, details = DETAILS) =>
  createOrderRequest(orderId, { userId, cardToken: '', cardId, details });

const getOrder = async (orderId: string, userId: string) =>
  (await call(Orders.getOrder, { orderId, userId })).response?.order;

/** Gunluk satirlari (alanlar, mesaj, hata nesnesinin mesaji ve yigini) ve outbox. */
async function writtenSoFar(): Promise<string> {
  const errors = lines
    .map((line) => line.fields.err)
    .filter((err): err is Error => err instanceof Error)
    .map((err) => `${err.message} ${err.stack ?? ''}`);
  return JSON.stringify([lines, errors, await orders.pending(1_000)]);
}

async function expectNoPersonalData(...extra: unknown[]): Promise<void> {
  // Bos gunlukte arama bos gecer: iki servisin de satir yazdigi dogrulanir.
  expect(new Set(lines.map((line) => line.fields.side))).toEqual(new Set(['order', 'payment']));
  const written = (await writtenSoFar()) + JSON.stringify(extra);
  for (const value of PERSONAL) {
    expect(written).not.toContain(value);
  }
}

describe('CreateOrder(card_id) gRPC, gercek payment-svc', () => {
  it('kasada olmayan kart: NOT_FOUND + resource "card"; siparis odeme bekler, kilit yerinde, odeme kaydi yok', async () => {
    const userId = 'usr_kartsiz';
    const { orderId, error } = await orderWith(userId);

    expect(error?.code).toBe(GRPC_STATUS.NOT_FOUND);
    expect(appErrorOf(error)).toEqual({
      code: ERROR_CODES.NOT_FOUND,
      details: { resource: 'card' },
    });
    const order = await getOrder(orderId, userId);
    expect(order?.status).toBe(orderV1.OrderStatus.ORDER_STATUS_AWAITING_PAYMENT);
    expect(order?.reservationExpiresAt).toBeInstanceOf(Date);
    expect(await paymentRecords.findByOrderId(orderId)).toBeNull();
    // Hata yolu gunlukte: order NOT_FOUND'u yazdi (ayrinti resource "card").
    expect(
      lines.some((line) => line.fields.rpc === 'CreateOrder' && line.fields.code === 'NOT_FOUND'),
    ).toBe(true);
    await expectNoPersonalData(error);
  });

  it('N1: ayni siparis kasadaki kartla yeniden: ESKI sonuc donmez, PAID; kayitta kartin kimligi', async () => {
    const userId = 'usr_kart-degistiren';
    const { orderId } = await orderWith(userId);
    const cardId = await savedCard(userId);

    const { error, response } = await call(Orders.createOrder, byCard(orderId, userId, cardId));

    expect(error).toBeUndefined();
    expect(response?.status).toBe(orderV1.OrderStatus.ORDER_STATUS_PAID);
    expect(await paymentRecords.findByOrderId(orderId)).toMatchObject({ cardId });
    await expectNoPersonalData(response);
  });

  it('MEDIUM bant: 3DS bitisi payment-svc nin penceresi (cekim + 60 sn), cevapta', async () => {
    const userId = 'usr_3ds-bitis';
    risk.band = RISK_BANDS.MEDIUM;
    try {
      const { response } = await orderWith(userId, await savedCard(userId));

      expect(response?.challengeId).toMatch(/^tds_/);
      expect(response?.challengeExpiresAt).toEqual(
        new Date(clock.now() + THREEDS_CHALLENGE_TTL_MS),
      );
    } finally {
      risk.band = RISK_BANDS.LOW;
    }
  });

  it('baskasinin kasadaki karti: NOT_FOUND (varlik sizdirmaz)', async () => {
    const strangersCard = await savedCard('usr_kart-sahibi');

    const { error } = await orderWith('usr_meraklı', strangersCard);

    expect(error?.code).toBe(GRPC_STATUS.NOT_FOUND);
    expect(appErrorOf(error)?.details).toEqual({ resource: 'card' });
  });
});

describe('Siparis ayrintilari gRPC (T12.4)', () => {
  it('GetOrder ayrintiyi doner (onay true, ani sunucu saati); ListMyOrders DONMEZ', async () => {
    const userId = 'usr_hediye';
    const { orderId, response } = await orderWith(userId, await savedCard(userId));
    expect(response?.status).toBe(orderV1.OrderStatus.ORDER_STATUS_PAID);

    expect((await getOrder(orderId, userId))?.details).toEqual({
      ...DETAILS,
      agreementsAcceptedAt: clock.date(),
    });
    const listed = await call(Orders.listMyOrders, { userId });
    expect(listed.response?.orders.map((order) => order.id)).toEqual([orderId]);
    expect(listed.response?.orders[0]?.details).toBeUndefined();
    await expectNoPersonalData();
  });

  it('tekrar denemede ilk ayrinti gecerli; farkli gelen yok sayilir', async () => {
    const userId = 'usr_fikir-degistiren';
    const { orderId } = await orderWith(userId);

    await call(Orders.createOrder, byCard(orderId, userId, await savedCard(userId), OTHER_DETAILS));

    expect((await getOrder(orderId, userId))?.details).toMatchObject({ note: DETAILS.note });
    const ignored = lines.filter((line) => line.message.includes('ayrintisi yok sayildi'));
    expect(ignored.map((line) => [line.level, line.fields.orderId])).toEqual([['info', orderId]]);
    await expectNoPersonalData();
  });

  it('kural disi ayrinti: INVALID_ARGUMENT, hata ayrintisi ve gunluk degeri YANKILAMAZ', async () => {
    const userId = 'usr_yanlis-telefon';
    const orderId = await newDraftId(call, { ...draftRequest, userId });

    const { error } = await call(
      Orders.createOrder,
      byCard(orderId, userId, MISSING_CARD, {
        ...DETAILS,
        gift: { ...GIFT, recipientPhone: '05321112233' },
      }),
    );

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(Object.keys(appErrorOf(error)?.details as object)).toEqual([
      'details.gift.recipientPhone',
    ]);
    expect(JSON.stringify(appErrorOf(error))).not.toContain('5321112233');
    await expectNoPersonalData(error?.details, error?.message);
  });
});
