/**
 * Siparis deposunu ACAR: MOCK=true -> bellek, aksi halde Mongo.
 *
 * Baglanmak, indeks kurmak ve hata olursa baglantiyi birakmak altyapi isidir;
 * bootstrap.ts'in tek isi parcalari BAGLAMAK (catalog-source.ts ile ayni ayrim).
 */

import type { Logger } from '@getir/core';
import { connectMongo } from '@getir/mongo-kit';
import type { MongoEnv } from '@getir/mongo-kit';

import { SERVICE_NAME } from '../config/constants.js';
import type { OrderHistoryReader } from '../domain/order-history-reader.js';
import type { OrderRepository } from '../domain/order-repository.js';
import { InMemoryOrderStore } from './memory/in-memory-order-store.js';
import { OrderMongoStore } from './mongo/order-mongo-store.js';
import { OrdersCollection } from './mongo/orders-collection.js';

export interface OrderStore {
  readonly repository: OrderRepository;
  readonly history: OrderHistoryReader;
  /** Gunlukte gorunen ad: hangi modda calisiyoruz? */
  readonly name: 'bellek (MOCK)' | 'mongo';
  /** Kapanista EN SON cagrilir (proje kurali: once cagrilar, sonra veritabani). */
  close(): Promise<void>;
}

export async function openOrderStore(
  mongo: MongoEnv | undefined,
  logger: Logger,
): Promise<OrderStore> {
  if (mongo === undefined) {
    const memory = new InMemoryOrderStore();
    return {
      repository: memory,
      history: memory,
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

  const orders = new OrdersCollection(connection.db);
  try {
    // Indeks acilista kurulur: ListMyOrders'in sirali okumasi ona dayanir.
    await orders.ensureIndexes();
  } catch (error: unknown) {
    // Baglanti acik kalirsa process kapanmaz ve hata gizlenir.
    await connection.close();
    throw error;
  }

  const store = new OrderMongoStore(orders);
  return { repository: store, history: store, name: 'mongo', close: () => connection.close() };
}
