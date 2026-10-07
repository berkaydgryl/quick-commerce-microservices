/**
 * order -> payment gRPC istemcisi (T7.1), GERCEK tel uzerinden: sahte bir
 * payment sunucusu ayaga kalkar. Istek/sonuc cevirisi, is hatasinin kodu ve
 * AYRINTISIYLA korunmasi (3DS kalan hak) ve requestId iletimi denenir. Kaydin
 * okunmasi (GetPayment, T11.2 PR 2): yontem ve durum, kayit yoksa null.
 */

import { AppError, ERROR_CODES, silentLogger } from '@getir/core';
import { paymentV1 } from '@getir/proto';
import {
  CircuitBreaker,
  REQUEST_ID_METADATA_KEY,
  startGrpcServer,
  toServiceError,
} from '@getir/service-kit';
import type { GrpcServerHandle } from '@getir/service-kit';
import type { sendUnaryData, ServerUnaryCall } from '@grpc/grpc-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ChargeRequest } from '../../src/application/payments.js';
import { PAYMENT_METHOD, PAYMENT_STATUS } from '../../src/domain/checkout-payment.js';
import { GrpcPayments } from '../../src/infrastructure/payment/grpc-payments.js';
import {
  cutAfterReach,
  DEADLINE_TIMEOUT_MS,
  FUNCTIONAL_TIMEOUT_MS,
  HeldReplies,
  REACH_BUDGET_MS,
} from '../support/held-replies.js';
import { businessError, UNAVAILABLE, withProbe } from '../support/qa-breaker-probe.js';

const scope = { requestId: 'req_odeme_1', logger: silentLogger };
const S = paymentV1.PaymentStatus;
const SLOW_ORDER_ID = 'ord_yavas';
/** Yavas siparisin bekletilen istekleri (cevap verilmez; kimlik ve kalan sure kaydedilir). */
const held = new HeldReplies();

const seenCharges: paymentV1.ChargeRequest[] = [];
const seenRefunds: paymentV1.RefundRequest[] = [];
const seenRequestIds: unknown[] = [];
const seenLookups: { orderId: string; requestId: unknown }[] = [];
/** Ilk cagrisi "ulasilamaz" donen siparisler (D17): siparis -> gorulen cagri sayisi. */
const flakyCalls = new Map<string, number>();
const FLAKY_PREFIX = 'ord_kesik';

/** Siparis "ord_kesik..." ise ilk cagri SERVICE_UNAVAILABLE ile duser. */
function failsFirst(orderId: string): boolean {
  if (!orderId.startsWith(FLAKY_PREFIX)) return false;
  const seen = (flakyCalls.get(orderId) ?? 0) + 1;
  flakyCalls.set(orderId, seen);
  return seen === 1;
}

const unavailableError = () =>
  toServiceError(new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'payment gecici olarak kapali'));

function payment(status: paymentV1.PaymentStatus, failureCode = ''): paymentV1.Payment {
  return paymentV1.Payment.fromPartial({ id: 'pay_1', orderId: 'ord_1', status, failureCode });
}

/** 3DS kodunun bitisi (T12.4): payment-svc'nin cevabindaki an. */
const CHALLENGE_EXPIRES_AT = new Date('2026-10-07T12:01:00Z');
/** Kasada olmayan kayitli kart: sahte sunucu NOT_FOUND (resource "card") doner. */
const MISSING_CARD_ID = 'crd_yok';

/** Sahte sunucunun jetona gore karari; kayitli kartla (card_id) onay. */
const CHARGE_RESPONSES: Readonly<Record<string, paymentV1.ChargeResponse>> = {
  tok_onay: { payment: payment(S.PAYMENT_STATUS_SUCCEEDED), challengeId: '' },
  tok_red: { payment: payment(S.PAYMENT_STATUS_FAILED, 'PAYMENT_DECLINED'), challengeId: '' },
  tok_tuhaf_neden: { payment: payment(S.PAYMENT_STATUS_FAILED, 'BILINMEYEN'), challengeId: '' },
  tok_3ds: { payment: payment(S.PAYMENT_STATUS_REQUIRES_3DS), challengeId: 'tds_1' },
  tok_3ds_bitisli: {
    payment: payment(S.PAYMENT_STATUS_REQUIRES_3DS),
    challengeId: 'tds_2',
    challengeExpiresAt: CHALLENGE_EXPIRES_AT,
  },
  // Dogrulama yokken gelen bitis anlamsizdir: tasinmaz.
  tok_bitis_yalniz: {
    payment: payment(S.PAYMENT_STATUS_SUCCEEDED),
    challengeId: '',
    challengeExpiresAt: CHALLENGE_EXPIRES_AT,
  },
  tok_durumsuz: { payment: payment(S.PAYMENT_STATUS_UNSPECIFIED), challengeId: '' },
  '': { payment: payment(S.PAYMENT_STATUS_PENDING), challengeId: '' },
};

/** GetPayment'in siparise gore kaydi; olmayan siparis NOT_FOUND. */
const RECORDS: Readonly<Record<string, paymentV1.Payment | 'kapali'>> = {
  ord_kart_cekildi: paymentV1.Payment.fromPartial({
    orderId: 'ord_kart_cekildi',
    method: paymentV1.PaymentMethod.PAYMENT_METHOD_CARD,
    status: S.PAYMENT_STATUS_SUCCEEDED,
  }),
  ord_kapida: paymentV1.Payment.fromPartial({
    orderId: 'ord_kapida',
    method: paymentV1.PaymentMethod.PAYMENT_METHOD_CASH_ON_DELIVERY,
    status: S.PAYMENT_STATUS_PENDING,
  }),
  ord_iptal: paymentV1.Payment.fromPartial({
    orderId: 'ord_iptal',
    method: paymentV1.PaymentMethod.PAYMENT_METHOD_CASH_ON_DELIVERY,
    status: S.PAYMENT_STATUS_CANCELLED,
  }),
  ord_yontemsiz: paymentV1.Payment.fromPartial({
    orderId: 'ord_yontemsiz',
    status: S.PAYMENT_STATUS_SUCCEEDED,
  }),
  ord_kapali: 'kapali',
};

const implementation = {
  charge: (
    call: ServerUnaryCall<paymentV1.ChargeRequest, paymentV1.ChargeResponse>,
    callback: sendUnaryData<paymentV1.ChargeResponse>,
  ): void => {
    seenCharges.push(call.request);
    seenRequestIds.push(call.metadata.get(REQUEST_ID_METADATA_KEY)[0]);
    if (call.request.cardId === MISSING_CARD_ID) {
      callback(
        toServiceError(
          new AppError(ERROR_CODES.NOT_FOUND, 'kart yok', { details: { resource: 'card' } }),
        ),
      );
      return;
    }
    const response =
      CHARGE_RESPONSES[call.request.cardId === '' ? call.request.cardToken : 'tok_onay'];
    callback(null, response ?? CHARGE_RESPONSES['tok_onay']);
  },
  confirm3Ds: (
    call: ServerUnaryCall<paymentV1.Confirm3DsRequest, paymentV1.Confirm3DsResponse>,
    callback: sendUnaryData<paymentV1.Confirm3DsResponse>,
  ): void => {
    if (failsFirst(call.request.orderId)) {
      callback(unavailableError());
      return;
    }
    if (call.request.code !== '123456') {
      callback(
        toServiceError(
          new AppError(ERROR_CODES.THREEDS_FAILED, 'yanlis kod', {
            details: { attemptsLeft: 2, reason: 'wrong_code' },
          }),
        ),
      );
      return;
    }
    callback(null, { payment: payment(S.PAYMENT_STATUS_SUCCEEDED) });
  },
  getPayment: (
    call: ServerUnaryCall<paymentV1.GetPaymentRequest, paymentV1.GetPaymentResponse>,
    callback: sendUnaryData<paymentV1.GetPaymentResponse>,
  ): void => {
    // Yavas siparis kayda YAZILMADAN bekletilir: gec gelen deneme baska testin at(-1)'ini bozmasin.
    if (call.request.orderId === SLOW_ORDER_ID) {
      held.hold(call);
      return;
    }
    seenLookups.push({
      orderId: call.request.orderId,
      requestId: call.metadata.get(REQUEST_ID_METADATA_KEY)[0],
    });
    if (failsFirst(call.request.orderId)) {
      callback(unavailableError());
      return;
    }
    const recorded = RECORDS[call.request.orderId];
    if (recorded === undefined) {
      callback(toServiceError(new AppError(ERROR_CODES.NOT_FOUND, 'odeme yok')));
      return;
    }
    if (recorded === 'kapali') {
      callback(toServiceError(new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'payment kapali')));
      return;
    }
    callback(null, { payment: recorded });
  },
  refund: (
    call: ServerUnaryCall<paymentV1.RefundRequest, paymentV1.RefundResponse>,
    callback: sendUnaryData<paymentV1.RefundResponse>,
  ): void => {
    seenRefunds.push(call.request);
    callback(null, { payment: payment(S.PAYMENT_STATUS_REFUNDED), alreadyRefunded: false });
  },
};

let handle: GrpcServerHandle;
let payments: GrpcPayments;

beforeAll(async () => {
  handle = await startGrpcServer({
    serviceName: 'fake-payment',
    host: '127.0.0.1',
    port: 0,
    services: [
      {
        name: 'getir.payment.v1.PaymentService',
        definition: paymentV1.PaymentServiceService,
        implementation,
      },
    ],
  });
  payments = new GrpcPayments(`127.0.0.1:${handle.port}`, FUNCTIONAL_TIMEOUT_MS);
});

afterAll(async () => {
  payments?.close();
  await handle?.shutdown('test bitti');
});

const charge = (overrides: Partial<ChargeRequest> = {}): ChargeRequest => ({
  orderId: 'ord_1',
  userId: 'usr_1',
  amountMinor: 7_990,
  currency: 'TRY',
  method: PAYMENT_METHOD.CARD,
  cardToken: 'tok_onay',
  idempotencyKey: 'charge-ord_1',
  requireThreeDs: true,
  ...overrides,
});

async function rejectionOf(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (error instanceof AppError) return error;
  throw new Error('AppError beklenirdi');
}

describe('GrpcPayments.charge', () => {
  it('istek telde birebir (tutar, yontem, anahtar, 3DS bayragi); requestId AYNEN iletilir', async () => {
    await expect(payments.charge(charge(), scope)).resolves.toEqual({
      status: PAYMENT_STATUS.SUCCEEDED,
    });
    expect(seenCharges.at(-1)).toEqual({
      orderId: 'ord_1',
      userId: 'usr_1',
      amount: { amountMinor: 7_990, currency: 'TRY' },
      method: paymentV1.PaymentMethod.PAYMENT_METHOD_CARD,
      cardToken: 'tok_onay',
      cardId: '',
      idempotencyKey: 'charge-ord_1',
      requireThreeDs: true,
    });
    expect(seenRequestIds.at(-1)).toBe(scope.requestId);
  });

  it('kapida odeme: jeton bos gider, PENDING doner', async () => {
    const { cardToken: _omitted, ...withoutToken } = charge({
      method: PAYMENT_METHOD.CASH_ON_DELIVERY,
      requireThreeDs: false,
    });

    await expect(payments.charge(withoutToken, scope)).resolves.toEqual({
      status: PAYMENT_STATUS.PENDING,
    });
    expect(seenCharges.at(-1)?.method).toBe(
      paymentV1.PaymentMethod.PAYMENT_METHOD_CASH_ON_DELIVERY,
    );
    expect(seenCharges.at(-1)?.cardToken).toBe('');
  });

  it.each([
    ['tok_red', { status: PAYMENT_STATUS.FAILED, failureCode: ERROR_CODES.PAYMENT_DECLINED }],
    // Sozlukte olmayan neden: kart reddi sayilir (para cekilmedi).
    [
      'tok_tuhaf_neden',
      { status: PAYMENT_STATUS.FAILED, failureCode: ERROR_CODES.PAYMENT_DECLINED },
    ],
    ['tok_3ds', { status: PAYMENT_STATUS.REQUIRES_3DS, challengeId: 'tds_1' }],
    // 3DS bitisi (T12.4) yalnizca dogrulama varken tasinir.
    [
      'tok_3ds_bitisli',
      {
        status: PAYMENT_STATUS.REQUIRES_3DS,
        challengeId: 'tds_2',
        challengeExpiresAt: CHALLENGE_EXPIRES_AT,
      },
    ],
    ['tok_bitis_yalniz', { status: PAYMENT_STATUS.SUCCEEDED }],
  ])('%s -> %o', async (cardToken, expected) => {
    await expect(payments.charge(charge({ cardToken }), scope)).resolves.toEqual(expected);
  });

  it('kayitli kart (T12.4): card_id telde, jeton bos gider', async () => {
    const { cardToken: _omitted, ...saved } = charge({ cardId: 'crd_kayitli' });

    await expect(payments.charge(saved, scope)).resolves.toEqual({
      status: PAYMENT_STATUS.SUCCEEDED,
    });
    expect(seenCharges.at(-1)).toMatchObject({ cardId: 'crd_kayitli', cardToken: '' });
  });

  it('kasada olmayan kart: NOT_FOUND kodu ve resource "card" AYNEN korunur', async () => {
    const { cardToken: _omitted, ...saved } = charge({ cardId: MISSING_CARD_ID });

    const error = await rejectionOf(payments.charge(saved, scope));

    expect(error.code).toBe(ERROR_CODES.NOT_FOUND);
    expect(error.details).toEqual({ resource: 'card' });
  });

  it('durumsuz cevapla siparis ilerletilmez: INTERNAL', async () => {
    const error = await rejectionOf(payments.charge(charge({ cardToken: 'tok_durumsuz' }), scope));

    expect(error.code).toBe(ERROR_CODES.INTERNAL);
  });
});

describe('GrpcPayments.confirmThreeDs ve refund', () => {
  it('dogru kod SUCCEEDED', async () => {
    await expect(
      payments.confirmThreeDs({ orderId: 'ord_1', challengeId: 'tds_1', code: '123456' }, scope),
    ).resolves.toEqual({ status: PAYMENT_STATUS.SUCCEEDED });
  });

  it('payment-svc nin THREEDS_FAILED i kodu ve AYRINTISIYLA (kalan hak) korunur', async () => {
    const error = await rejectionOf(
      payments.confirmThreeDs({ orderId: 'ord_1', challengeId: 'tds_1', code: '000000' }, scope),
    );

    expect(error.code).toBe(ERROR_CODES.THREEDS_FAILED);
    expect(error.details).toEqual({ attemptsLeft: 2, reason: 'wrong_code' });
  });

  it('iade istegi gerekce ve anahtarla gider', async () => {
    await payments.refund(
      { orderId: 'ord_1', reason: 'order_changed_during_payment', idempotencyKey: 'refund-ord_1' },
      scope,
    );

    expect(seenRefunds.at(-1)).toEqual({
      orderId: 'ord_1',
      reason: 'order_changed_during_payment',
      idempotencyKey: 'refund-ord_1',
    });
  });
});

describe('GrpcPayments.getPayment (T11.2 PR 2)', () => {
  it('kaydin durumu ve yontemi domain sozlugune cevrilir; requestId AYNEN iletilir', async () => {
    await expect(payments.getPayment('ord_kart_cekildi', scope)).resolves.toEqual({
      status: PAYMENT_STATUS.SUCCEEDED,
      method: PAYMENT_METHOD.CARD,
    });
    await expect(payments.getPayment('ord_kapida', scope)).resolves.toEqual({
      status: PAYMENT_STATUS.PENDING,
      method: PAYMENT_METHOD.CASH_ON_DELIVERY,
    });
    expect(seenLookups.at(-1)).toEqual({ orderId: 'ord_kapida', requestId: scope.requestId });
  });

  it('tahsil edilmeden kapatilmis odeme (T11.2 PR 3) CANCELLED okunur', async () => {
    await expect(payments.getPayment('ord_iptal', scope)).resolves.toEqual({
      status: PAYMENT_STATUS.CANCELLED,
      method: PAYMENT_METHOD.CASH_ON_DELIVERY,
    });
  });

  it('kayit yoksa (NOT_FOUND) null: o siparis icin hic cekim istenmedi', async () => {
    await expect(payments.getPayment('ord_cekimsiz', scope)).resolves.toBeNull();
  });

  it('yontemi bilinmeyen kayitla karar verilmez: INTERNAL', async () => {
    const error = await rejectionOf(payments.getPayment('ord_yontemsiz', scope));

    expect(error.code).toBe(ERROR_CODES.INTERNAL);
  });

  it('payment-svc hatasi AYNEN yukari gider (iptal ve supurucu karar vermez)', async () => {
    const error = await rejectionOf(payments.getPayment('ord_kapali', scope));

    expect(error.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
  });
});

describe('GrpcPayments - dayaniklilik (D17)', () => {
  const resilience = () => ({
    breaker: new CircuitBreaker({ target: 'payment', failureThreshold: 2, openMs: 60_000 }),
    retry: { target: 'payment', maxRetries: 2, baseDelayMs: 1 },
  });
  const connectPayments = (address: string) =>
    new GrpcPayments(address, FUNCTIONAL_TIMEOUT_MS, resilience());
  let resilient: GrpcPayments;

  beforeAll(() => {
    resilient = new GrpcPayments(`127.0.0.1:${handle.port}`, FUNCTIONAL_TIMEOUT_MS, resilience());
  });

  afterAll(() => {
    resilient?.close();
  });

  it('idempotent okuma (GetPayment) ilk deneme duserse yeniden denenir ve sonuc doner', async () => {
    await expect(resilient.getPayment('ord_kesik_okuma', scope)).resolves.toBeNull();
    expect(flakyCalls.get('ord_kesik_okuma')).toBe(2);
  });

  it('3DS onayi yeniden DENENMEZ (tekrar, kullanicinin hakkini bosa yakabilir)', async () => {
    const error = await rejectionOf(
      resilient.confirmThreeDs(
        { orderId: 'ord_kesik_3ds', challengeId: 'tds_1', code: '123456' },
        scope,
      ),
    );

    expect(error.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
    expect(flakyCalls.get('ord_kesik_3ds')).toBe(1);
  });

  it('ulasilamayan servise ust uste hatadan sonra devre acilir; cagri ag a gitmeden hemen reddedilir', async () => {
    // Kanit sunucu sayaci (#123): kapali port ve hiz olcumu kesicisiz de geciyordu.
    await withProbe(
      'payment',
      paymentV1.PaymentServiceService,
      connectPayments,
      async (client, faults) => {
        faults.setAll(UNAVAILABLE);
        const confirm = () =>
          rejectionOf(
            client.confirmThreeDs(
              { orderId: 'ord_1', challengeId: 'tds_1', code: '123456' },
              scope,
            ),
          );
        await confirm();
        await confirm();
        const reached = faults.calls();

        const rejected = await rejectionOf(client.getPayment('ord_1', scope));

        expect(rejected.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
        expect(faults.calls()).toBe(reached);
      },
    );
  });

  it('is hatasi (yanlis 3DS kodu) devreyi ACMAZ', async () => {
    await withProbe(
      'payment',
      paymentV1.PaymentServiceService,
      connectPayments,
      async (client, faults) => {
        faults.set('confirm3Ds', businessError(ERROR_CODES.THREEDS_FAILED));
        const confirm = () =>
          rejectionOf(
            client.confirmThreeDs(
              { orderId: 'ord_1', challengeId: 'tds_1', code: '000000' },
              scope,
            ),
          );
        for (let i = 0; i < 4; i += 1) await confirm();
        // Esik 2, dort is hatasi: hepsi sunucuya ulasti.
        expect(faults.calls('confirm3Ds')).toBe(4);

        // Iki yonlu kanit (#123): ayni istemcide devre gercekten acilabiliyor.
        faults.setAll(UNAVAILABLE);
        await confirm();
        await confirm();
        const reached = faults.calls();
        await rejectionOf(client.getPayment('ord_1', scope));
        expect(faults.calls()).toBe(reached);
      },
    );
  });
});

describe('GrpcPayments sure siniri (#113)', () => {
  let shortDeadline: GrpcPayments;

  beforeAll(() => {
    shortDeadline = new GrpcPayments(`127.0.0.1:${handle.port}`, DEADLINE_TIMEOUT_MS);
  });

  afterAll(() => {
    shortDeadline?.close();
  });

  it('sure siniri dolarsa SERVICE_UNAVAILABLE; istemci KENDI kisa sinirini gonderir', async () => {
    const { error, reply } = await cutAfterReach(
      (requestId) => shortDeadline.getPayment(SLOW_ORDER_ID, { requestId, logger: silentLogger }),
      held,
      REACH_BUDGET_MS,
    );

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
    // Istek sunucuya ulasti ve istemci kendi kisa sinirini gonderdi.
    expect(reply.remainingMs).toBeLessThanOrEqual(DEADLINE_TIMEOUT_MS);
  });
});
