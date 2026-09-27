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
import type { OrderOutbox } from '../domain/order-outbox.js';
import type { OrderRepository } from '../domain/order-repository.js';
import { InMemoryOrderStore } from './memory/in-memory-order-store.js';
import { MongoOrderOutbox } from './mongo/mongo-order-outbox.js';
import { OrderMongoStore } from './mongo/order-mongo-store.js';
import { OrdersCollection } from './mongo/orders-collection.js';
import { OutboxCollection } from './mongo/outbox-collection.js';

export interface OrderStore {
  readonly repository: OrderRepository;
  readonly history: OrderHistoryReader;
  /** Yayin tarafi (T7.3): yayinci okur/isaretler, saga telafi komutu ekler. */
  readonly outbox: OrderOutbox;
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
      outbox: memory,
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
  const outbox = new OutboxCollection(connection.db);
  try {
    // Indeksler acilista kurulur: ListMyOrders'in sirali okumasi ve yayincinin
    // "yayinlanmamis, sirali" okumasi onlara dayanir.
    await orders.ensureIndexes();
    await outbox.ensureIndexes();
  } catch (error: unknown) {
    // Baglanti acik kalirsa process kapanmaz ve hata gizlenir.
    await connection.close();
    throw error;
  }

  const store = new OrderMongoStore(orders, outbox, connection);
  return {
    repository: store,
    history: store,
    outbox: new MongoOrderOutbox(outbox),
    name: 'mongo',
    close: () => connection.close(),
  };
}
