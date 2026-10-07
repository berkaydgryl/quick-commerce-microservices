/**
 * QA PQ5 (T15.2, payment geriye donuk PR 2): gRPC sinirlari (IQ7 deseni). Gercek payment sunucusu
 * (bellek deposu, saglayici casusu); her gecersiz istek tel uzerinde INVALID_ARGUMENT +
 * VALIDATION_FAILED, ayrintida alan adi. Kanit yalniz hata degil: KAYIT YAZILMAZ, saglayiciya
 * GIDILMEZ, 3DS hakki DUSMEZ, iade edilmis kayit DEGISMEZ; hata ayrintisi gonderilen degeri
 * yankilamaz.
 */

import { ID_PREFIX, MOCK_THREEDS_CODE, newId } from '@getir/core';
import type { paymentV1 } from '@getir/proto';
import { IDEMPOTENCY_KEY_MAX_LENGTH, REFUND_REASON_MAX_LENGTH } from '@getir/contracts';
import { appErrorOf, appErrorPayloadOf, startTestGrpcServer } from '@getir/service-kit/testing';
import type { TestGrpcServer } from '@getir/service-kit/testing';
import { status } from '@grpc/grpc-js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildPaymentService } from '../../src/bootstrap.js';
import { InMemoryPaymentStore } from '../../src/infrastructure/memory/in-memory-payment-store.js';
import { ProviderSpy } from '../support/qa-provider-spy.js';
import {
  AMOUNT_MINOR,
  chargeRequest,
  newOrder,
  Payments,
  STATUS,
  TOKEN,
} from '../support/qa-payment-requests.js';
import type { Order } from '../support/qa-payment-requests.js';

const VALIDATION = { code: 'VALIDATION_FAILED' };
const CARD_ID = `crd_${'a'.repeat(32)}`;
/** Gizli kalmasi gereken deger: hata ayrintisinda gecmemeli. */
const SECRET_TOKEN = 'tok_gizli_deger_123';

let repository: InMemoryPaymentStore;
let provider: ProviderSpy;
let server: TestGrpcServer;

beforeEach(async () => {
  repository = new InMemoryPaymentStore();
  provider = new ProviderSpy();
  server = await startTestGrpcServer({
    serviceName: 'qa-payment-limits',
    services: [buildPaymentService({ repository, provider })],
  });
});

afterEach(async () => {
  await server.stop();
});

/** Reddedildi: VALIDATION_FAILED, beklenen alan ayrintida, kayit yok, saglayiciya gidilmedi. */
async function expectRejected(
  order: Order,
  request: ReturnType<typeof chargeRequest>,
  field: string,
) {
  const { error } = await server.call(Payments.charge, request);
  const appError = appErrorOf(error);
  expect(appError).toMatchObject(VALIDATION);
  expect(Object.keys(appError?.details ?? {})).toContain(field);
  expect(`${error?.message ?? ''} ${JSON.stringify(appErrorPayloadOf(error))}`).not.toContain(
    SECRET_TOKEN,
  );
  // Kayit yok: istekte kimlik bozuk olsa da (bos, bosluk) siparis ve anahtarla aranir.
  expect(await repository.findByOrderId(order.orderId)).toBeNull();
  expect(await repository.findByOrderId(request.orderId)).toBeNull();
  expect(await repository.findByIdempotencyKey(order.key)).toBeNull();
  expect(provider.authorized).toBe(0);
}

describe('QA PQ5 Charge sinirlari: reddedilir, kayit yok, saglayiciya gidilmez', () => {
  const card = { kind: 'token', token: TOKEN.APPROVE } as const;
  const cases: readonly (readonly [
    string,
    (order: Order) => ReturnType<typeof chargeRequest>,
    string,
  ])[] = [
    [
      'tutar 0',
      (o) => chargeRequest(o, card, { amount: { amountMinor: 0, currency: 'TRY' } }),
      'amount.amountMinor',
    ],
    [
      'tutar negatif',
      (o) => chargeRequest(o, card, { amount: { amountMinor: -1, currency: 'TRY' } }),
      'amount.amountMinor',
    ],
    [
      'para birimi USD',
      (o) => chargeRequest(o, card, { amount: { amountMinor: AMOUNT_MINOR, currency: 'USD' } }),
      'amount.currency',
    ],
    ['siparis kimligi bos', (o) => chargeRequest({ ...o, orderId: '   ' }, card), 'orderId'],
    ['kullanici bos', (o) => chargeRequest({ ...o, userId: '' }, card), 'userId'],
    ['anahtar bos', (o) => chargeRequest({ ...o, key: '' }, card), 'idempotencyKey'],
    [
      `anahtar ${IDEMPOTENCY_KEY_MAX_LENGTH + 1} karakter`,
      (o) => chargeRequest({ ...o, key: 'k'.repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1) }, card),
      'idempotencyKey',
    ],
    ['yontem belirtilmemis', (o) => chargeRequest(o, card, { method: 0 }), 'method'],
    [
      'bilinmeyen yontem',
      (o) => chargeRequest(o, card, { method: 99 as paymentV1.PaymentMethod }),
      'method',
    ],
    ['kartli, kart yok', (o) => chargeRequest(o, card, { cardToken: '' }), 'cardId'],
    ['kartli, yalniz bosluk jeton', (o) => chargeRequest(o, card, { cardToken: '   ' }), 'cardId'],
    [
      'card_id ve card_token birlikte',
      (o) => chargeRequest(o, card, { cardId: CARD_ID, cardToken: SECRET_TOKEN }),
      'cardId',
    ],
    ['card_id bicimsiz', (o) => chargeRequest(o, { kind: 'saved', cardId: 'crd_xyz' }), 'cardId'],
    [
      'card_id buyuk harf',
      (o) => chargeRequest(o, { kind: 'saved', cardId: CARD_ID.toUpperCase() }),
      'cardId',
    ],
    [
      'card_id 31 hane',
      (o) => chargeRequest(o, { kind: 'saved', cardId: CARD_ID.slice(0, -1) }),
      'cardId',
    ],
    [
      'kapida odemede jeton',
      (o) => chargeRequest(o, { kind: 'cod' }, { cardToken: SECRET_TOKEN }),
      'cardId',
    ],
    [
      'kapida odemede card_id',
      (o) => chargeRequest(o, { kind: 'cod' }, { cardId: CARD_ID }),
      'cardId',
    ],
    [
      'kapida odemede 3DS',
      (o) => chargeRequest(o, { kind: 'cod' }, { requireThreeDs: true }),
      'requireThreeDs',
    ],
  ];

  it.each(cases)('%s', async (_label, build, field) => {
    const order = newOrder();
    await expectRejected(order, build(order), field);
  });
});

describe('QA PQ5 Confirm3Ds sinirlari: bicimi bozuk kod deneme sayilmaz', () => {
  async function challenged(): Promise<{ order: Order; challengeId: string }> {
    const order = newOrder();
    const { response } = await server.call(
      Payments.charge,
      chargeRequest(order, { kind: 'token', token: TOKEN.CHALLENGE }),
    );
    expect(response?.payment?.status).toBe(STATUS.PAYMENT_STATUS_REQUIRES_3DS);
    return { order, challengeId: response?.challengeId ?? '' };
  }

  it.each([
    ['5 hane', '12345', 'code'],
    ['7 hane', '1234567', 'code'],
    ['harf', '12345a', 'code'],
    ['bos', '', 'code'],
  ])('kod %s: VALIDATION_FAILED, hak dusmez, saglayiciya gidilmez', async (_label, code, field) => {
    const { order, challengeId } = await challenged();

    const { error } = await server.call(Payments.confirm3Ds, {
      orderId: order.orderId,
      challengeId,
      code,
    });

    expect(appErrorOf(error)).toMatchObject(VALIDATION);
    expect(Object.keys(appErrorOf(error)?.details ?? {})).toContain(field);
    const payment = await repository.findByOrderId(order.orderId);
    expect(payment?.challenge?.failedAttempts).toBe(0);
    expect(payment?.status).toBe('REQUIRES_3DS');
    // Hak dusmedi: dogru kod hala kabul edilir.
    const accepted = await server.call(Payments.confirm3Ds, {
      orderId: order.orderId,
      challengeId,
      code: MOCK_THREEDS_CODE,
    });
    expect(accepted.response?.payment?.status).toBe(STATUS.PAYMENT_STATUS_SUCCEEDED);
  });

  it('jeton bos: VALIDATION_FAILED, kayit degismez', async () => {
    const { order } = await challenged();
    const { error } = await server.call(Payments.confirm3Ds, {
      orderId: order.orderId,
      challengeId: '',
      code: MOCK_THREEDS_CODE,
    });
    expect(appErrorOf(error)).toMatchObject(VALIDATION);
    expect((await repository.findByOrderId(order.orderId))?.status).toBe('REQUIRES_3DS');
  });
});

describe('QA PQ5 Refund ve GetPayment sinirlari', () => {
  async function paid(): Promise<Order> {
    const order = newOrder();
    await server.call(
      Payments.charge,
      chargeRequest(order, { kind: 'token', token: TOKEN.APPROVE }),
    );
    return order;
  }

  it.each([
    ['gerekce bos', { reason: '' }, 'reason'],
    ['gerekce buyuk harf ve bosluk', { reason: 'Order Cancelled' }, 'reason'],
    [
      `gerekce ${REFUND_REASON_MAX_LENGTH + 1} karakter`,
      { reason: 'a'.repeat(REFUND_REASON_MAX_LENGTH + 1) },
      'reason',
    ],
    ['anahtar bos', { idempotencyKey: '' }, 'idempotencyKey'],
  ])('%s: VALIDATION_FAILED, odeme SUCCEEDED kalir', async (_label, override, field) => {
    const order = await paid();
    const { error } = await server.call(Payments.refund, {
      orderId: order.orderId,
      reason: 'order_cancelled',
      idempotencyKey: `qa-refund-${order.orderId}`,
      ...override,
    });
    expect(appErrorOf(error)).toMatchObject(VALIDATION);
    expect(Object.keys(appErrorOf(error)?.details ?? {})).toContain(field);
    expect((await repository.findByOrderId(order.orderId))?.status).toBe('SUCCEEDED');
  });

  it('GetPayment bos ya da bosluk siparis kimligi: VALIDATION_FAILED', async () => {
    for (const orderId of ['', '   ']) {
      const { error } = await server.call(Payments.getPayment, { orderId });
      expect(appErrorOf(error)).toMatchObject(VALIDATION);
    }
  });
});

// BULGU #147 (dusuk): payment'in gRPC semasinda tutar ve kimlik icin UST SINIR yok; guvenli tam
// sayiyi asan tutar dogrulamaya ulasmadan INTERNAL olur. Tek istemci order (tutari kendisi
// hesaplar). #147: sinir eklenince TERSINE donecek (VALIDATION_FAILED, kayit yok).
describe('QA PQ5 MEVCUT davranis: ust sinir yoklamalari', () => {
  it('guvenli tam sayiyi asan tutar (2^53): INVALID_ARGUMENT degil INTERNAL (cozumleme hatasi), kayit yok', async () => {
    const order = newOrder();
    const { error } = await server.call(
      Payments.charge,
      chargeRequest(
        order,
        { kind: 'token', token: TOKEN.APPROVE },
        { amount: { amountMinor: 2 ** 53, currency: 'TRY' } },
      ),
    );
    expect(error?.code).toBe(status.INTERNAL);
    expect(error?.message).toContain('deserializing');
    expect(await repository.findByOrderId(order.orderId)).toBeNull();
    expect(provider.authorized).toBe(0);
  });

  it('siparis kimligi uzunluk siniri yok: 10.000 karakter kabul edilir ve yazilir', async () => {
    const order = { ...newOrder(), orderId: newId(ID_PREFIX.ORDER) + 'x'.repeat(10_000) };
    const { error } = await server.call(
      Payments.charge,
      chargeRequest(order, { kind: 'token', token: TOKEN.APPROVE }),
    );
    expect(error).toBeUndefined();
    expect(await repository.findByOrderId(order.orderId)).not.toBeNull();
  });
});
