/**
 * Log baglami (D2): use-case'in yazdigi satir, istegin x-request-id'sini ve
 * rpc adini tasir. Gercek gRPC sunucusu + gercek istemci; saglayiciya bilerek
 * ulasilamaz, boylece Charge'in error satiri yazilir.
 */

import type { LogFields, Logger } from '@getir/core';
import { paymentV1 } from '@getir/proto';
import { REQUEST_ID_METADATA_KEY, startGrpcServer } from '@getir/service-kit';
import type { GrpcServerHandle } from '@getir/service-kit';
import { Client, credentials, Metadata } from '@grpc/grpc-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildPaymentService } from '../../src/bootstrap.js';
import type { PaymentProvider } from '../../src/domain/payment-provider.js';

const REQUEST_ID = 'req_log_baglami_payment';

interface LogLine {
  readonly level: string;
  readonly fields: LogFields;
  readonly message: string;
}

/** Alt gunlukcu alanlarini birlestirerek her satiri kaydeder (pino'nun child'i gibi). */
function recordingLogger(lines: LogLine[], bound: LogFields = {}): Logger {
  const write =
    (level: string) =>
    (fields: LogFields, message: string): void => {
      lines.push({ level, fields: { ...bound, ...fields }, message });
    };
  return {
    debug: write('debug'),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
    fatal: write('fatal'),
    child: (fields) => recordingLogger(lines, { ...bound, ...fields }),
  };
}

const lines: LogLine[] = [];
const unreachableProvider: PaymentProvider = {
  authorize: () => Promise.reject(new Error('saglayici yok')),
  verifyChallenge: () => Promise.reject(new Error('saglayici yok')),
};

let handle: GrpcServerHandle;
let client: Client;

beforeAll(async () => {
  handle = await startGrpcServer({
    serviceName: 'payment-log-test',
    host: '127.0.0.1',
    port: 0,
    services: [
      buildPaymentService({ provider: unreachableProvider, logger: recordingLogger(lines) }),
    ],
  });
  client = new Client(`127.0.0.1:${handle.port}`, credentials.createInsecure());
});

afterAll(async () => {
  client?.close();
  await handle?.shutdown('test bitti');
});

describe('Charge - log baglami', () => {
  it("saglayici hatasi satiri istegin requestId'sini ve rpc adini tasir", async () => {
    const metadata = new Metadata();
    metadata.set(REQUEST_ID_METADATA_KEY, REQUEST_ID);
    const method = paymentV1.PaymentServiceService.charge;
    const request: paymentV1.ChargeRequest = {
      orderId: 'ord_log',
      userId: 'usr_1',
      amount: { amountMinor: 12_990, currency: 'TRY' },
      method: paymentV1.PaymentMethod.PAYMENT_METHOD_CARD,
      cardToken: 'tok_test_4242',
      idempotencyKey: 'anahtar-log-0001',
    };

    await new Promise<void>((resolve, reject) => {
      client.makeUnaryRequest(
        method.path,
        method.requestSerialize,
        method.responseDeserialize,
        request,
        metadata,
        (error) => (error === null ? resolve() : reject(error)),
      );
    });

    const failure = lines.find((line) => line.message === 'odeme saglayicisina ulasilamadi');
    expect(failure).toMatchObject({
      level: 'error',
      fields: { requestId: REQUEST_ID, rpc: 'Charge', orderId: 'ord_log' },
    });
  });
});
