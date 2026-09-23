/**
 * Odeme deposunun Mongo uygulamasi - gercek Mongo (Testcontainers).
 *
 * Sahte istemciyle dogrulanamayan seyler burada sinanir:
 *   1. Sozlesme: bellek uygulamasiyla AYNI senaryolar gercek sorguda
 *      (unique indeksler, surum kosullu replaceOne, alan kaybi).
 *   2. Indeksler: orderId ve idempotencyKey gercekten unique.
 *   3. T5.3 "bitti sayilir": servis yeniden baslayinca 3DS sayaci ve kilit
 *      korunur; denemeler belgede attempts[] olarak gorulur.
 *   4. Iyimser kilit gercek veritabaninda: es zamanli iki yanlis kod iki hak yakar.
 */

import { ERROR_CODES, MOCK_THREEDS_CODE } from '@getir/core';
import { connectMongo } from '@getir/mongo-kit';
import type { MongoConnection } from '@getir/mongo-kit';
import { paymentV1 } from '@getir/proto';
import { startGrpcServer } from '@getir/service-kit';
import type { GrpcServerHandle } from '@getir/service-kit';
import { Client, credentials, Metadata } from '@grpc/grpc-js';
import type { MethodDefinition, ServiceError } from '@grpc/grpc-js';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildPaymentService } from '../../src/bootstrap.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import type { PaymentDocument } from '../../src/infrastructure/mongo/documents.js';
import { PaymentMongoStore } from '../../src/infrastructure/mongo/payment-mongo-store.js';
import { PaymentsCollection } from '../../src/infrastructure/mongo/payments-collection.js';
import { appErrorOf } from '../support/grpc-error.js';
import { describePaymentStoreContract } from '../support/payment-store-contract.js';

/** infra/docker/docker-compose.dev.yml ile ayni surum. */
const MONGO_IMAGE = 'mongo:7';
const DB_NAME = 'getir_payment_test';
const EPHEMERAL_PORT = 0;
const WRONG_CODE = '000000';

let container: StartedMongoDBContainer;
let connection: MongoConnection;
let store: PaymentMongoStore;

const uri = (): string => `${container.getConnectionString()}?directConnection=true`;

/** Yeni baglanti + indeks + depo: servisin acilisini birebir taklit eder. */
async function openStore(): Promise<{ store: PaymentMongoStore; connection: MongoConnection }> {
  const opened = await connectMongo({ uri: uri(), dbName: DB_NAME });
  const payments = new PaymentsCollection(opened.db);
  await payments.ensureIndexes();
  return { store: new PaymentMongoStore(payments), connection: opened };
}

beforeAll(async () => {
  container = await new MongoDBContainer(MONGO_IMAGE).start();
  ({ store, connection } = await openStore());
});

afterAll(async () => {
  await connection.close();
  await container.stop();
});

describePaymentStoreContract('mongo', () => store);

describe('indeksler', () => {
  it('orderId ve idempotencyKey unique indeksleri kurulu', async () => {
    const indexes = await connection.db.collection(COLLECTIONS.PAYMENTS).indexes();
    const unique = indexes.filter((index) => index.unique === true).map((index) => index.key);

    expect(unique).toEqual(expect.arrayContaining([{ orderId: 1 }, { idempotencyKey: 1 }]));
  });
});

// ---------------------------------------------------------------------------
// gRPC uzerinden: servis acilir, kapanir, YENI baglantiyla yeniden acilir.
// ---------------------------------------------------------------------------

interface RunningService {
  readonly handle: GrpcServerHandle;
  readonly client: Client;
  readonly connection: MongoConnection;
}

async function startService(): Promise<RunningService> {
  const opened = await openStore();
  const handle = await startGrpcServer({
    serviceName: 'payment-int',
    host: '127.0.0.1',
    port: EPHEMERAL_PORT,
    services: [buildPaymentService({ repository: opened.store })],
  });
  const client = new Client(`127.0.0.1:${handle.port}`, credentials.createInsecure());
  return { handle, client, connection: opened.connection };
}

async function stopService(service: RunningService): Promise<void> {
  service.client.close();
  await service.handle.shutdown('test: yeniden baslatma');
  await service.connection.close();
}

function call<TRequest, TResponse>(
  client: Client,
  method: MethodDefinition<TRequest, TResponse>,
  request: TRequest,
): Promise<{ error: ServiceError | undefined; response: TResponse | undefined }> {
  return new Promise((resolve) => {
    client.makeUnaryRequest(
      method.path,
      method.requestSerialize,
      method.responseDeserialize,
      request,
      new Metadata(),
      (error, response) => {
        resolve({ error: error ?? undefined, response: response ?? undefined });
      },
    );
  });
}

async function chargeWith3Ds(client: Client, orderId: string): Promise<string> {
  const { response } = await call(client, paymentV1.PaymentServiceService.charge, {
    orderId,
    userId: 'usr_1',
    amount: { amountMinor: 12_990, currency: 'TRY' },
    method: paymentV1.PaymentMethod.PAYMENT_METHOD_CARD,
    cardToken: 'tok_test_3184',
    idempotencyKey: `anahtar-${orderId}`,
  });
  return response?.challengeId ?? '';
}

function confirm(client: Client, orderId: string, challengeId: string, code: string) {
  return call(client, paymentV1.PaymentServiceService.confirm3Ds, { orderId, challengeId, code });
}

async function rawDocument(orderId: string): Promise<PaymentDocument | null> {
  return connection.db.collection<PaymentDocument>(COLLECTIONS.PAYMENTS).findOne({ orderId });
}

describe('T5.3: yeniden baslatma sonrasi 3DS sayaci ve kilit', () => {
  it('sayac korunur: once 1 yanlis, yeniden baslat, sonraki yanlis attemptsLeft 1', async () => {
    const first = await startService();
    const challengeId = await chargeWith3Ds(first.client, 'ord_restart-1');
    const before = await confirm(first.client, 'ord_restart-1', challengeId, WRONG_CODE);
    expect(appErrorOf(before.error)?.details).toEqual({ attemptsLeft: 2, reason: 'wrong_code' });
    await stopService(first);

    const second = await startService();
    const after = await confirm(second.client, 'ord_restart-1', challengeId, WRONG_CODE);
    await stopService(second);

    // Bellekte olsaydi yeniden baslatma hakki sifirlar, cevap yine 2 olurdu.
    expect(appErrorOf(after.error)?.details).toEqual({ attemptsLeft: 1, reason: 'wrong_code' });
  });

  it('kilit korunur: 3 yanlis, yeniden baslat, dogru kod da reddedilir', async () => {
    const first = await startService();
    const challengeId = await chargeWith3Ds(first.client, 'ord_restart-2');
    for (let i = 0; i < 3; i += 1) {
      await confirm(first.client, 'ord_restart-2', challengeId, WRONG_CODE);
    }
    await stopService(first);

    const second = await startService();
    const { error } = await confirm(second.client, 'ord_restart-2', challengeId, MOCK_THREEDS_CODE);
    await stopService(second);

    expect(appErrorOf(error)).toMatchObject({
      code: ERROR_CODES.THREEDS_FAILED,
      details: { attemptsLeft: 0, reason: 'attempts_exhausted' },
    });
  });

  it('denemeler belgede attempts[] olarak gorulur; kod ve kart verisi belgede yok', async () => {
    const service = await startService();
    const challengeId = await chargeWith3Ds(service.client, 'ord_restart-3');
    await confirm(service.client, 'ord_restart-3', challengeId, WRONG_CODE);
    await confirm(service.client, 'ord_restart-3', challengeId, MOCK_THREEDS_CODE);
    await stopService(service);

    const document = await rawDocument('ord_restart-3');
    expect(document?.status).toBe('SUCCEEDED');
    expect(document?.threeDS).toMatchObject({ challengeId, failedAttempts: 1 });
    expect(document?.attempts.map((a) => `${a.kind}:${a.outcome}`)).toEqual([
      'CHARGE:CHALLENGE_REQUIRED',
      'THREEDS:CODE_REJECTED',
      'THREEDS:CODE_ACCEPTED',
    ]);
    const serialized = JSON.stringify(document);
    expect(serialized).not.toContain(WRONG_CODE);
    expect(serialized).not.toContain(MOCK_THREEDS_CODE);
    expect(serialized).not.toContain('tok_test_');
  });
});

describe("iyimser kilit gercek Mongo'da", () => {
  it('es zamanli iki yanlis kod iki hak yakar', async () => {
    const service = await startService();
    const challengeId = await chargeWith3Ds(service.client, 'ord_race-1');

    await Promise.all([
      confirm(service.client, 'ord_race-1', challengeId, WRONG_CODE),
      confirm(service.client, 'ord_race-1', challengeId, WRONG_CODE),
    ]);
    await stopService(service);

    expect((await rawDocument('ord_race-1'))?.threeDS?.failedAttempts).toBe(2);
  });
});
