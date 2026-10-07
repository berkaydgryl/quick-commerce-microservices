/**
 * Log baglami (D2): use-case'in yazdigi satir, istegin x-request-id'sini ve
 * rpc adini tasir. Gercek gRPC sunucusu + gercek istemci; saglayiciya bilerek
 * ulasilamaz, boylece Charge'in error satiri yazilir.
 */

import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { paymentV1 } from '@getir/proto';
import { REQUEST_ID_METADATA_KEY } from '@getir/service-kit';
import { unaryCall } from '@getir/service-kit/testing';
import { Metadata } from '@grpc/grpc-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PaymentProvider } from '../../src/domain/payment-provider.js';
import { startPaymentService } from '../support/payment-grpc-client.js';
import type { RunningPaymentService } from '../support/payment-grpc-client.js';

const REQUEST_ID = 'req_log_baglami_payment';

const lines: LogLine[] = [];
const unreachableProvider: PaymentProvider = {
  authorize: () => Promise.reject(new Error('saglayici yok')),
  verifyChallenge: () => Promise.reject(new Error('saglayici yok')),
};

let service: RunningPaymentService;

beforeAll(async () => {
  service = await startPaymentService(
    { provider: unreachableProvider, logger: recordingLogger(lines) },
    'payment-log-test',
  );
});

afterAll(async () => {
  await service?.stop();
});

describe('Charge - log baglami', () => {
  it("saglayici hatasi satiri istegin requestId'sini ve rpc adini tasir", async () => {
    const metadata = new Metadata();
    metadata.set(REQUEST_ID_METADATA_KEY, REQUEST_ID);
    const request: paymentV1.ChargeRequest = {
      orderId: 'ord_log',
      userId: 'usr_1',
      amount: { amountMinor: 12_990, currency: 'TRY' },
      method: paymentV1.PaymentMethod.PAYMENT_METHOD_CARD,
      cardToken: 'tok_test_4242',
      cardId: '',
      idempotencyKey: 'anahtar-log-0001',
      requireThreeDs: false,
    };

    const { error } = await unaryCall(
      service.client,
      paymentV1.PaymentServiceService.charge,
      request,
      metadata,
    );

    // Saglayiciya ulasilamamasi gRPC hatasi degil: kayit FAILED olur, cevap doner.
    expect(error).toBeUndefined();

    const failure = lines.find((line) => line.message === 'odeme saglayicisina ulasilamadi');
    expect(failure).toMatchObject({
      level: 'error',
      fields: { requestId: REQUEST_ID, rpc: 'Charge', orderId: 'ord_log' },
    });
  });
});
