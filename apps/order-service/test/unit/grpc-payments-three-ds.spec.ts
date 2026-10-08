/**
 * order -> payment 3DS okumasi (#163 B1; GrpcPayments.getThreeDs), GERCEK tel
 * uzerinden: sahte payment sunucusu GetPayment'a three_ds ile cevap verir.
 * Ceviri (sahip + dogrulama, yorumsuz), kayit yoksa null, sozlesmesi bozuk
 * cevapta jetonsuz INTERNAL. Okuma kritik odeme yolundan AYRIDIR: kendi kisa
 * siniri (THREE_DS_READ_TIMEOUT_MS), yeniden deneme yok, paylasilan devreye
 * hata saymaz; sure asiminda GetOrder siparisi 3DS'siz doner.
 */

import { AppError, ERROR_CODES, fixedClock, silentLogger } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
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

import { createGetOrder } from '../../src/application/get-order.js';
import { THREE_DS_READ_TIMEOUT_MS } from '../../src/config/constants.js';
import { PAYMENT_METHOD, PAYMENT_STATUS } from '../../src/domain/checkout-payment.js';
import { InMemoryOrderStore } from '../../src/infrastructure/memory/in-memory-order-store.js';
import { GrpcPayments } from '../../src/infrastructure/payment/grpc-payments.js';
import {
  cutAfterReach,
  DEADLINE_TIMEOUT_MS,
  FUNCTIONAL_TIMEOUT_MS,
  HeldReplies,
  REACH_BUDGET_MS,
} from '../support/held-replies.js';
import { insertAwaitingPayment } from '../support/order-builders.js';
import { UNAVAILABLE, withProbe } from '../support/qa-breaker-probe.js';

const scope = { requestId: 'req_3ds_okuma_1', logger: silentLogger };
const S = paymentV1.PaymentStatus;
const CHALLENGE_ID = 'tds_0009d7cd0e904b689aabcacf4458d520';
const EXPIRES_AT = new Date('2026-10-08T09:00:42Z');
const SLOW_ORDER_ID = 'ord_3ds_yavas';
/** Cevabi HIC verilmeyen siparisler (sure siniri); GetOrder testi kendi siparisini ekler. */
const slowOrders = new Set([SLOW_ORDER_ID]);
/** Ilk cagrisi "ulasilamaz" donen siparisler: siparis -> sunucuya ulasan cagri sayisi. */
const FLAKY_PREFIX = 'ord_3ds_kesik';
const flakyCalls = new Map<string, number>();
const held = new HeldReplies();
const seenLookups: { orderId: string; requestId: unknown }[] = [];

function record(status: paymentV1.PaymentStatus): paymentV1.Payment {
  return paymentV1.Payment.fromPartial({
    id: 'pay_1',
    userId: 'usr_1',
    method: paymentV1.PaymentMethod.PAYMENT_METHOD_CARD,
    status,
  });
}

/** GetPayment'in siparise gore cevabi; olmayan siparis NOT_FOUND. */
const RESPONSES: Readonly<Record<string, paymentV1.GetPaymentResponse>> = {
  ord_acik: {
    payment: record(S.PAYMENT_STATUS_REQUIRES_3DS),
    threeDs: { challengeId: CHALLENGE_ID, expiresAt: EXPIRES_AT, attemptsLeft: 2 },
  },
  ord_hakki_bitti: {
    payment: record(S.PAYMENT_STATUS_FAILED),
    threeDs: { challengeId: '', expiresAt: EXPIRES_AT, attemptsLeft: 0 },
  },
  ord_dogrulamasiz: { payment: record(S.PAYMENT_STATUS_SUCCEEDED) },
  ord_kayitsiz: { threeDs: { challengeId: CHALLENGE_ID, expiresAt: EXPIRES_AT, attemptsLeft: 2 } },
  ord_bitissiz: {
    payment: record(S.PAYMENT_STATUS_REQUIRES_3DS),
    threeDs: { challengeId: CHALLENGE_ID, attemptsLeft: 2 },
  },
};

const implementation = {
  getPayment: (
    call: ServerUnaryCall<paymentV1.GetPaymentRequest, paymentV1.GetPaymentResponse>,
    callback: sendUnaryData<paymentV1.GetPaymentResponse>,
  ): void => {
    const { orderId } = call.request;
    if (slowOrders.has(orderId)) {
      held.hold(call);
      return;
    }
    seenLookups.push({ orderId, requestId: call.metadata.get(REQUEST_ID_METADATA_KEY)[0] });
    if (orderId.startsWith(FLAKY_PREFIX)) {
      const calls = (flakyCalls.get(orderId) ?? 0) + 1;
      flakyCalls.set(orderId, calls);
      callback(
        calls === 1
          ? toServiceError(new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'gecici'))
          : null,
        { payment: record(S.PAYMENT_STATUS_SUCCEEDED) },
      );
      return;
    }
    const response = RESPONSES[orderId];
    if (response === undefined) {
      callback(toServiceError(new AppError(ERROR_CODES.NOT_FOUND, 'odeme yok')));
      return;
    }
    callback(null, response);
  },
};

let handle: GrpcServerHandle;
let payments: GrpcPayments;
const address = () => `127.0.0.1:${handle.port}`;

beforeAll(async () => {
  handle = await startGrpcServer({
    serviceName: 'fake-payment-3ds',
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
  payments = new GrpcPayments(address(), FUNCTIONAL_TIMEOUT_MS);
});

afterAll(async () => {
  payments?.close();
  await handle?.shutdown('test bitti');
});

async function rejectionOf(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (error instanceof AppError) return error;
  throw new Error('AppError beklenirdi');
}

describe('GrpcPayments.getThreeDs (#163 B1)', () => {
  it('acik dogrulama: kaydin sahibi ve jeton, bitis, kalan hak; requestId AYNEN iletilir', async () => {
    await expect(payments.getThreeDs('ord_acik', scope)).resolves.toEqual({
      userId: 'usr_1',
      threeDs: { challengeId: CHALLENGE_ID, expiresAt: EXPIRES_AT, attemptsLeft: 2 },
    });
    expect(seenLookups.at(-1)).toEqual({ orderId: 'ord_acik', requestId: scope.requestId });
  });

  it('kapali dogrulama yorumlanmadan tasinir (jetonsuz, hak 0)', async () => {
    await expect(payments.getThreeDs('ord_hakki_bitti', scope)).resolves.toEqual({
      userId: 'usr_1',
      threeDs: { challengeId: '', expiresAt: EXPIRES_AT, attemptsLeft: 0 },
    });
  });

  it('dogrulamasiz kayit yalnizca sahibi doner; kayit yoksa null', async () => {
    await expect(payments.getThreeDs('ord_dogrulamasiz', scope)).resolves.toEqual({
      userId: 'usr_1',
    });
    await expect(payments.getThreeDs('ord_cekimsiz', scope)).resolves.toBeNull();
  });

  it('getPayment (supurucu, iptal, dusen kilit) ayni kayittan jetonu TUTMAZ: yalnizca durum ve yontem', async () => {
    const snapshot = await payments.getPayment('ord_acik', scope);

    expect(snapshot).toEqual({ status: PAYMENT_STATUS.REQUIRES_3DS, method: PAYMENT_METHOD.CARD });
    expect(JSON.stringify(snapshot)).not.toContain('tds_');
  });

  it.each(['ord_bitissiz', 'ord_kayitsiz'])(
    'sozlesme bozuk (%s): INTERNAL (sahip uyusmazligi degil), mesajda ve ayrintida jeton YOK',
    async (orderId) => {
      const error = await rejectionOf(payments.getThreeDs(orderId, scope));

      expect(error.code).toBe(ERROR_CODES.INTERNAL);
      expect(error.details).toEqual({ orderId });
      expect(`${error.message} ${JSON.stringify(error.details)}`).not.toContain('tds_');
    },
  );
});

describe('3DS okumasi kritik odeme yolundan AYRI (#163 B1)', () => {
  it('yeniden deneme YOK: ilk deneme duserse tek cagri; getPayment ayni istemcide yeniden dener', async () => {
    const resilient = new GrpcPayments(address(), FUNCTIONAL_TIMEOUT_MS, {
      retry: { target: 'payment', maxRetries: 2, baseDelayMs: 1 },
    });
    try {
      const error = await rejectionOf(resilient.getThreeDs(`${FLAKY_PREFIX}_3ds`, scope));
      expect(error.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
      expect(flakyCalls.get(`${FLAKY_PREFIX}_3ds`)).toBe(1);

      // Iki yonlu kanit: ayni istemcinin kritik okumasi yeniden denenir.
      await expect(resilient.getPayment(`${FLAKY_PREFIX}_kritik`, scope)).resolves.toEqual({
        status: PAYMENT_STATUS.SUCCEEDED,
        method: PAYMENT_METHOD.CARD,
      });
      expect(flakyCalls.get(`${FLAKY_PREFIX}_kritik`)).toBe(2);
    } finally {
      resilient.close();
    }
  });

  it('3DS okuma hatalari paylasilan devreyi ACMAZ; kritik cagri sunucuya ulasir', async () => {
    await withProbe(
      'payment',
      paymentV1.PaymentServiceService,
      (probeAddress) =>
        new GrpcPayments(probeAddress, FUNCTIONAL_TIMEOUT_MS, {
          breaker: new CircuitBreaker({ target: 'payment', failureThreshold: 2, openMs: 60_000 }),
        }),
      async (client, faults) => {
        faults.setAll(UNAVAILABLE);
        for (let i = 0; i < 4; i += 1) {
          await rejectionOf(client.getThreeDs('ord_1', scope));
        }
        // Esik 2, dort 3DS okuma hatasi: hepsi sunucuya ulasti, devre kapali.
        expect(faults.calls()).toBe(4);
        await rejectionOf(client.getPayment('ord_1', scope));
        expect(faults.calls()).toBe(5);

        // Iki yonlu kanit: kritik yolun ikinci hatasi devreyi acar.
        await rejectionOf(client.getPayment('ord_1', scope));
        const reached = faults.calls();
        await rejectionOf(client.getPayment('ord_1', scope));
        expect(faults.calls()).toBe(reached);
      },
    );
  });

  it('kendi kisa siniri: THREE_DS_READ_TIMEOUT_MS (payment siniri degil); dolunca SERVICE_UNAVAILABLE', async () => {
    const { error, reply } = await cutAfterReach(
      (requestId) => payments.getThreeDs(SLOW_ORDER_ID, { requestId, logger: silentLogger }),
      held,
      REACH_BUDGET_MS,
    );

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
    // Istemcinin payment siniri FUNCTIONAL_TIMEOUT_MS (2 sn); 3DS okumasi kendi 1 sn'siyle gitti.
    expect(reply.remainingMs).toBeLessThanOrEqual(THREE_DS_READ_TIMEOUT_MS);
  });

  it('sure asiminda GetOrder siparisi DUSURMEZ: 3DS yok + WARN (SERVICE_UNAVAILABLE)', async () => {
    const clock = fixedClock(Date.UTC(2026, 9, 8, 9, 0));
    const repository = new InMemoryOrderStore();
    const awaiting = await insertAwaitingPayment(repository, clock);
    slowOrders.add(awaiting.id);
    const shortRead = new GrpcPayments(address(), FUNCTIONAL_TIMEOUT_MS, {}, DEADLINE_TIMEOUT_MS);
    const lines: LogLine[] = [];
    try {
      const getOrder = createGetOrder({ repository, payments: shortRead });

      const view = await getOrder(
        { orderId: awaiting.id, userId: awaiting.userId },
        { requestId: 'req_3ds_sure_asimi', logger: recordingLogger(lines) },
      );

      expect(view.order.id).toBe(awaiting.id);
      expect(view).not.toHaveProperty('threeDs');
      expect(lines.filter((line) => line.level === 'warn')).toEqual([
        {
          level: 'warn',
          fields: { orderId: awaiting.id, code: ERROR_CODES.SERVICE_UNAVAILABLE },
          message: '3DS durumu okunamadi; siparis 3DS durumsuz donuyor',
        },
      ]);
    } finally {
      shortRead.close();
    }
  });
});
