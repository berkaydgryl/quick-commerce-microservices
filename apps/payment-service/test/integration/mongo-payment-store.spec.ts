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
import type { MongoConnection } from '@getir/mongo-kit';
import { appErrorOf } from '@getir/service-kit/testing';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import type { PaymentDocument } from '../../src/infrastructure/mongo/documents.js';
import type { PaymentMongoStore } from '../../src/infrastructure/mongo/payment-mongo-store.js';
import {
  chargeWith3Ds,
  confirm3Ds,
  openPaymentStore,
  startMongoPaymentService,
} from '../support/mongo-payment-service.js';
import type { MongoTarget } from '../support/mongo-payment-service.js';
import { describePaymentStoreContract } from '../support/payment-store-contract.js';

/** infra/docker/docker-compose.dev.yml ile ayni surum. */
const MONGO_IMAGE = 'mongo:7';
const DB_NAME = 'getir_payment_test';
const WRONG_CODE = '000000';

let container: StartedMongoDBContainer;
let connection: MongoConnection;
let store: PaymentMongoStore;

const target = (): MongoTarget => ({
  uri: `${container.getConnectionString()}?directConnection=true`,
  dbName: DB_NAME,
});

beforeAll(async () => {
  container = await new MongoDBContainer(MONGO_IMAGE).start();
  ({ store, connection } = await openPaymentStore(target()));
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
// gRPC uzerinden: servis acilir, kapanir, YENI baglantiyla yeniden acilir
// (duzenek test/support/mongo-payment-service.ts).
// ---------------------------------------------------------------------------

const startService = () => startMongoPaymentService(target());

async function rawDocument(orderId: string): Promise<PaymentDocument | null> {
  return connection.db.collection<PaymentDocument>(COLLECTIONS.PAYMENTS).findOne({ orderId });
}

describe('T5.3: yeniden baslatma sonrasi 3DS sayaci ve kilit', () => {
  it('sayac korunur: once 1 yanlis, yeniden baslat, sonraki yanlis attemptsLeft 1', async () => {
    const first = await startService();
    const challengeId = await chargeWith3Ds(first.client, 'ord_restart-1');
    const before = await confirm3Ds(first.client, 'ord_restart-1', challengeId, WRONG_CODE);
    expect(appErrorOf(before.error)?.details).toEqual({ attemptsLeft: 2, reason: 'wrong_code' });
    await first.stop();

    const second = await startService();
    const after = await confirm3Ds(second.client, 'ord_restart-1', challengeId, WRONG_CODE);
    await second.stop();

    // Bellekte olsaydi yeniden baslatma hakki sifirlar, cevap yine 2 olurdu.
    expect(appErrorOf(after.error)?.details).toEqual({ attemptsLeft: 1, reason: 'wrong_code' });
  });

  it('kilit korunur: 3 yanlis, yeniden baslat, dogru kod da reddedilir', async () => {
    const first = await startService();
    const challengeId = await chargeWith3Ds(first.client, 'ord_restart-2');
    for (let i = 0; i < 3; i += 1) {
      await confirm3Ds(first.client, 'ord_restart-2', challengeId, WRONG_CODE);
    }
    await first.stop();

    const second = await startService();
    const { error } = await confirm3Ds(
      second.client,
      'ord_restart-2',
      challengeId,
      MOCK_THREEDS_CODE,
    );
    await second.stop();

    expect(appErrorOf(error)).toMatchObject({
      code: ERROR_CODES.THREEDS_FAILED,
      details: { attemptsLeft: 0, reason: 'attempts_exhausted' },
    });
  });

  it('denemeler belgede attempts[] olarak gorulur; kod ve kart verisi belgede yok', async () => {
    const service = await startService();
    const challengeId = await chargeWith3Ds(service.client, 'ord_restart-3');
    await confirm3Ds(service.client, 'ord_restart-3', challengeId, WRONG_CODE);
    await confirm3Ds(service.client, 'ord_restart-3', challengeId, MOCK_THREEDS_CODE);
    await service.stop();

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
      confirm3Ds(service.client, 'ord_race-1', challengeId, WRONG_CODE),
      confirm3Ds(service.client, 'ord_race-1', challengeId, WRONG_CODE),
    ]);
    await service.stop();

    expect((await rawDocument('ord_race-1'))?.threeDS?.failedAttempts).toBe(2);
  });
});
