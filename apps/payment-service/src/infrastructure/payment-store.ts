/**
 * Odeme deposunu ACAR: MOCK=true -> bellek, aksi halde Mongo.
 *
 * Baglanmak, indeks kurmak ve hata olursa baglantiyi birakmak altyapi isidir;
 * bootstrap.ts'in tek isi parcalari BAGLAMAK (order-store.ts ile ayni ayrim).
 */

import type { Logger } from '@getir/core';
import { connectMongo } from '@getir/mongo-kit';
import type { MongoEnv } from '@getir/mongo-kit';

import { SERVICE_NAME } from '../config/constants.js';
import type { PaymentRepository } from '../domain/payment-repository.js';
import { InMemoryPaymentStore } from './memory/in-memory-payment-store.js';
import { PaymentMongoStore } from './mongo/payment-mongo-store.js';
import { PaymentsCollection } from './mongo/payments-collection.js';

export interface PaymentStore {
  readonly repository: PaymentRepository;
  /** Gunlukte gorunen ad: hangi modda calisiyoruz? */
  readonly name: 'bellek (MOCK)' | 'mongo';
  /** Kapanista EN SON cagrilir (proje kurali: once cagrilar, sonra veritabani). */
  close(): Promise<void>;
}

export async function openPaymentStore(
  mongo: MongoEnv | undefined,
  logger: Logger,
): Promise<PaymentStore> {
  if (mongo === undefined) {
    return {
      repository: new InMemoryPaymentStore(),
      name: 'bellek (MOCK)',
      close: () => Promise.resolve(),
    };
  }

  const connection = await connectMongo({
    uri: mongo.MONGO_URI,
    dbName: mongo.MONGO_DB,
    serverSelectionTimeoutMs: mongo.MONGO_SERVER_SELECTION_TIMEOUT_MS,
    appName: SERVICE_NAME,
    logger,
  });

  const payments = new PaymentsCollection(connection.db);
  try {
    // Unique indeksler acilista kurulur: siparis basina tek odeme ve
    // idempotency ona dayanir; indekssiz calismak kurali sessizce kapatirdi.
    await payments.ensureIndexes();
  } catch (error: unknown) {
    // Baglanti acik kalirsa process kapanmaz ve hata gizlenir.
    await connection.close();
    throw error;
  }

  return {
    repository: new PaymentMongoStore(payments),
    name: 'mongo',
    close: () => connection.close(),
  };
}
