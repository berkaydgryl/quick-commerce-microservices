/**
 * Persona seed'inin Mongo yazicisi (T8.1) - gercek Mongo (Testcontainers).
 *
 * Sahte istemciyle dogrulanamayanlar: silme + yazmanin TEK transaction'da
 * olmasi (tekrar kosunca kopya yok), baska kullanicinin siparisine
 * dokunulmamasi, olay yazilmamasi ve risk gecmisinin Mongo aggregation'iyla
 * tablodaki sayilari vermesi.
 */

import { connectMongo } from '@getir/mongo-kit';
import type { MongoConnection } from '@getir/mongo-kit';
import { systemClock } from '@getir/core';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDraftOrder } from '../../src/domain/order.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import { MongoPersonaOrderWriter } from '../../src/infrastructure/mongo/mongo-persona-order-writer.js';
import { OrderMongoStore } from '../../src/infrastructure/mongo/order-mongo-store.js';
import { OrdersCollection } from '../../src/infrastructure/mongo/orders-collection.js';
import { OutboxCollection } from '../../src/infrastructure/mongo/outbox-collection.js';
import {
  buildPersonaOrders,
  PERSONA_HISTORIES,
  personaUserIds,
} from '../../src/infrastructure/fixtures/persona-orders.js';
import { sampleDraftInput } from '../support/order-builders.js';

/** infra/docker/docker-compose.dev.yml ile ayni surum. */
const MONGO_IMAGE = 'mongo:7';
const DB_NAME = 'getir_order_persona_test';

let container: StartedMongoDBContainer;
let connection: MongoConnection;
let store: OrderMongoStore;
let writer: MongoPersonaOrderWriter;

beforeAll(async () => {
  container = await new MongoDBContainer(MONGO_IMAGE).start();
  connection = await connectMongo({
    uri: `${container.getConnectionString()}?directConnection=true`,
    dbName: DB_NAME,
  });
  const orders = new OrdersCollection(connection.db);
  const outbox = new OutboxCollection(connection.db);
  await orders.ensureIndexes();
  await outbox.ensureIndexes();
  store = new OrderMongoStore(orders, outbox, connection);
  writer = new MongoPersonaOrderWriter(orders, connection);
});

afterAll(async () => {
  await connection.close();
  await container.stop();
});

describe('persona siparis gecmisi (Mongo)', () => {
  it('tekrar kosunca kopya olusmaz, baskasinin siparisine ve outboxa dokunulmaz', async () => {
    const stranger = createDraftOrder(sampleDraftInput({ userId: 'usr_baskasi' }), systemClock);
    await store.insert(stranger, []);
    const orders = buildPersonaOrders(new Date());

    await writer.replaceForUsers(personaUserIds(), orders);
    await writer.replaceForUsers(personaUserIds(), buildPersonaOrders(new Date()));

    const collection = connection.db.collection(COLLECTIONS.ORDERS);
    await expect(
      collection.countDocuments({ userId: { $in: [...personaUserIds()] } }),
    ).resolves.toBe(orders.length);
    await expect(store.findById(stranger.id)).resolves.not.toBeNull();
    await expect(connection.db.collection(COLLECTIONS.OUTBOX).countDocuments()).resolves.toBe(0);
  });

  it('risk gecmisi Mongo sorgusuyla tablodaki sayilari verir', async () => {
    await writer.replaceForUsers(personaUserIds(), buildPersonaOrders(new Date()));
    const can = PERSONA_HISTORIES.find((history) => history.persona === 'Can');
    const komsu = PERSONA_HISTORIES.find((history) => history.persona === 'Komsu');

    await expect(store.riskHistory(can?.userId ?? '')).resolves.toEqual({
      deliveredCount: 1,
      cancelledCount: 3,
      averageBasketMinor: 12_000,
    });
    await expect(store.riskHistory(komsu?.userId ?? '')).resolves.toEqual({
      deliveredCount: 12,
      cancelledCount: 1,
      averageBasketMinor: 28_000,
    });
  });
});
