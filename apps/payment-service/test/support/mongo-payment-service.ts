/**
 * Mongo'ya bagli payment servisi: entegrasyon testinin yeniden baslatma
 * duzenegi (T5.3 "servis yeniden baslayinca 3DS sayaci ve kilit korunur").
 * Her acilis servisin kendi acilisini taklit eder: YENI baglanti, indeksler,
 * depo, gRPC sunucusu. Kapanis sirasi main.ts ile ayni: sunucu, sonra baglanti.
 */

import { connectMongo } from '@getir/mongo-kit';
import type { MongoConnection } from '@getir/mongo-kit';
import { paymentV1 } from '@getir/proto';
import { unaryCall } from '@getir/service-kit/testing';
import type { Client } from '@grpc/grpc-js';

import { PaymentMongoStore } from '../../src/infrastructure/mongo/payment-mongo-store.js';
import { PaymentsCollection } from '../../src/infrastructure/mongo/payments-collection.js';
import { startPaymentService } from './payment-grpc-client.js';

export interface MongoTarget {
  readonly uri: string;
  readonly dbName: string;
}

export interface OpenedStore {
  readonly store: PaymentMongoStore;
  readonly connection: MongoConnection;
}

/** Yeni baglanti + indeks + depo. */
export async function openPaymentStore(target: MongoTarget): Promise<OpenedStore> {
  const connection = await connectMongo({ uri: target.uri, dbName: target.dbName });
  const payments = new PaymentsCollection(connection.db);
  await payments.ensureIndexes();
  return { store: new PaymentMongoStore(payments), connection };
}

export interface RunningMongoPaymentService {
  readonly client: Client;
  stop(): Promise<void>;
}

export async function startMongoPaymentService(
  target: MongoTarget,
): Promise<RunningMongoPaymentService> {
  const { store, connection } = await openPaymentStore(target);
  const service = await startPaymentService({ repository: store }, 'payment-int');
  return {
    client: service.client,
    stop: async () => {
      await service.stop('test: yeniden baslatma');
      await connection.close();
    },
  };
}

/** 3DS karti ile cekim acar; jetonu doner (onkosul adimi, kendisi test edilmez). */
export async function chargeWith3Ds(client: Client, orderId: string): Promise<string> {
  const { response } = await unaryCall(client, paymentV1.PaymentServiceService.charge, {
    orderId,
    userId: 'usr_1',
    amount: { amountMinor: 12_990, currency: 'TRY' },
    method: paymentV1.PaymentMethod.PAYMENT_METHOD_CARD,
    cardToken: 'tok_test_3184',
    idempotencyKey: `anahtar-${orderId}`,
    requireThreeDs: false,
  });
  return response?.challengeId ?? '';
}

export function confirm3Ds(client: Client, orderId: string, challengeId: string, code: string) {
  return unaryCall(client, paymentV1.PaymentServiceService.confirm3Ds, {
    orderId,
    challengeId,
    code,
  });
}
