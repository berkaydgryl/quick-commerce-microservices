/**
 * Siparis deposunu ACAR: MOCK=true -> bellek, aksi halde Mongo.
 *
 * Bellekte demo personalarinin siparis gecmisi acilista yuklenir (T8.1): MOCK'ta
 * seed komutu calismaz, persona bantlari yine de dogru cikmali. Production'da
 * YUKLENMEZ.
 *
 * Baglanmak, indeks kurmak ve hata olursa baglantiyi birakmak altyapi isidir;
 * bootstrap.ts'in tek isi parcalari BAGLAMAK (catalog-source.ts ile ayni ayrim).
 */

import type { Logger } from '@getir/core';
import { applyMigrations, connectMongo } from '@getir/mongo-kit';
import type { MongoEnv } from '@getir/mongo-kit';

import { SERVICE_NAME } from '../config/constants.js';
import type { OrderServiceEnv } from '../config/env.js';
import type { AwaitingCourierFinder } from '../domain/awaiting-courier-finder.js';
import type { ExpiredOrderFinder } from '../domain/expired-order-finder.js';
import type { OrderHistoryReader } from '../domain/order-history-reader.js';
import type { OrderOutbox } from '../domain/order-outbox.js';
import type { OrderRepository } from '../domain/order-repository.js';
import { MIGRATIONS } from '../migrations/index.js';
import { buildPersonaOrders } from './fixtures/persona-orders.js';
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
  /** Supurucunun is kuyrugu (T11.2 PR 2): kilidi dolmus siparisler. */
  readonly expired: ExpiredOrderFinder;
  /** Kurye iscisinin is kuyrugu (T13.1 PR 2): kurye bekleyen siparisler. */
  readonly awaitingCourier: AwaitingCourierFinder;
  /** Gunlukte gorunen ad: hangi modda calisiyoruz? */
  readonly name: 'bellek (MOCK)' | 'mongo';
  /** Kapanista EN SON cagrilir (proje kurali: once cagrilar, sonra veritabani). */
  close(): Promise<void>;
}

export async function openOrderStore(
  mongo: MongoEnv | undefined,
  logger: Logger,
  nodeEnv: OrderServiceEnv['NODE_ENV'],
): Promise<OrderStore> {
  if (mongo === undefined) {
    const memory = new InMemoryOrderStore();
    if (nodeEnv !== 'production') {
      const orders = buildPersonaOrders(new Date());
      for (const order of orders) {
        await memory.insert(order, []);
      }
      logger.info({ orders: orders.length }, 'persona siparis gecmisi bellege yuklendi (MOCK)');
    }
    return {
      repository: memory,
      history: memory,
      outbox: memory,
      expired: memory,
      awaitingCourier: memory,
      name: 'bellek (MOCK)',
      close: () => Promise.resolve(),
    };
  }

  const connection = await connectMongo({ ...mongo, appName: SERVICE_NAME, logger });

  const orders = new OrdersCollection(connection.db);
  const outbox = new OutboxCollection(connection.db);
  try {
    // Gocler indekslerden ONCE (T10.4, ADR-19): kod uygulanmamis semayla calismaz.
    await applyMigrations(connection, MIGRATIONS, logger);
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
    expired: store,
    awaitingCourier: store,
    name: 'mongo',
    close: () => connection.close(),
  };
}
