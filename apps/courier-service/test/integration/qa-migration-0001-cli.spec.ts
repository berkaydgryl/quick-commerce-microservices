/**
 * QA kara kutu (T13.2 PR 1): goc 0001 (kurye havuzu) KULLANICININ YOLUYLA.
 *
 *   1. T13.1 bicimli KARISIK veri (hic atanmamis IDLE, daha once atanmis IDLE, BUSY,
 *      OFFLINE, Besiktas'ta IDLE) + eski indeks; servis ACILIS yoluyla acilir
 *      (openCourierStore: goc + indeks). Gocten ONCE atanmis siparisin tekrar istegi
 *      AYNI kuryeyi alir; OFFLINE havuza girmez; sira idleSince'ten; semtler ayri.
 *   2. Goc komutu GERCEK surec (node dist/migrate.js): status -> down -> down -> up -> up.
 *      down T13.1 bicimine doner ve atamalari korur; ikinci down ve ikinci up bos gecer.
 *   3. Servis yeniden acilir: down/up'tan gecen atamalar ayni, havuz calisir.
 *
 * Backend'in testleri (migrations.spec.ts) goc fonksiyonlarini dogrudan cagirir;
 * burada acilis yolu, komut satiri, OFFLINE kurye ve gocten once baglanmis siparis var.
 */

import { fixedClock, GRPC_STATUS, silentLogger } from '@getir/core';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { MongoClient } from 'mongodb';
import type { Document } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { courierV1 } from '@getir/proto';

import { openCourierStore } from '../../src/infrastructure/courier-store.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import {
  courierId,
  FAR_MARKET,
  FAR_MARKET_LOCATION,
  MARKET,
  MARKET_LOCATION,
  NOW_MS,
  orderId,
  SEEDED_AT,
} from '../support/couriers.js';
import { assertBuilt, CLI_ENTRY, logLine, runCourierCli } from '../support/qa-cli.js';
import { outcomeOf, startQaCourierServer } from '../support/qa-courier-harness.js';

const MONGO_IMAGE = 'mongo:7';
const DB_NAME = 'getir_courier_qa_goc';
const OLD_ASSIGNMENT_INDEX = 'marketId_status_lastAssignedAt';
const MIGRATION = '1 kurye-havuzu';
const STORE_TIMEOUT_MS = 10_000;

let container: StartedMongoDBContainer;
let raw: MongoClient;

const mongo = () => ({
  uri: `${container.getConnectionString()}/?directConnection=true`,
  dbName: DB_NAME,
});
const collection = () => raw.db(DB_NAME).collection<Document>(COLLECTIONS.COURIERS);
const minute = (value: number): Date => new Date(SEEDED_AT.getTime() + value * 60_000);

/** Gocten once (T13.1) baglanmis siparis. */
const PRE_UPGRADE_ORDER = orderId();

/** T13.1 bicimli kurye belgesi: markete bagli, konum {lat, lng}, idleSince yok. */
function t131(
  n: number,
  marketId: string,
  location: { readonly lat: number; readonly lng: number },
  fields: Document,
): Document {
  return {
    _id: courierId(n),
    name: `Kurye ${n}`,
    marketId,
    status: 'IDLE',
    lastLocation: { lat: location.lat, lng: location.lng },
    lastLocationAt: SEEDED_AT,
    ...fields,
  };
}

const LEGACY: readonly Document[] = [
  t131(1, MARKET, MARKET_LOCATION, {}), // hic atanmamis: bosta beklemesi seed aninda
  t131(2, MARKET, MARKET_LOCATION, { lastAssignedAt: minute(30) }), // sonra bosalmis
  t131(3, MARKET, MARKET_LOCATION, {
    status: 'BUSY',
    currentOrderId: PRE_UPGRADE_ORDER,
    lastAssignedAt: minute(45),
  }),
  t131(4, MARKET, MARKET_LOCATION, { status: 'OFFLINE' }),
  t131(5, FAR_MARKET, FAR_MARKET_LOCATION, {}),
];

async function startService() {
  const clock = fixedClock(NOW_MS);
  const store = await openCourierStore(
    { ...mongo(), serverSelectionTimeoutMs: 5_000, operationTimeoutMs: STORE_TIMEOUT_MS },
    { logger: silentLogger, clock },
  );
  const server = await startQaCourierServer({
    repository: store.repository,
    markets: store.markets,
    clock,
  });
  return {
    server,
    stop: async () => {
      await server.stop();
      await store.close();
    },
  };
}

async function indexNames(): Promise<string[]> {
  return (await collection().indexes()).map((index) => String(index.name)).sort();
}

const byId = async (): Promise<Map<string, Document>> =>
  new Map(
    (await collection().find().toArray()).map((document) => [String(document._id), document]),
  );

beforeAll(async () => {
  assertBuilt();
  container = await new MongoDBContainer(MONGO_IMAGE).start();
  raw = await MongoClient.connect(mongo().uri);
  await collection().insertMany([...LEGACY]);
  await collection().createIndex(
    { marketId: 1, status: 1, lastAssignedAt: 1, _id: 1 },
    { name: OLD_ASSIGNMENT_INDEX },
  );
  await collection().createIndex(
    { currentOrderId: 1 },
    {
      name: 'currentOrderId_unique',
      unique: true,
      partialFilterExpression: { currentOrderId: { $exists: true } },
    },
  );
});

afterAll(async () => {
  await raw?.close();
  await container?.stop();
});

describe('QA T13.2 goc 0001 kullanicinin yoluyla (acilis + komut satiri)', () => {
  // Siparisler adimlar arasinda tasinir: ayni veritabaninda ardisik adimlar.
  const orders = { a: orderId(), b: orderId(), far: orderId() };

  it('1. T13.1 verisiyle servis acilir: gocten once baglanan siparis AYNI kuryeyi alir; OFFLINE girmez; sira idleSince; semtler ayri', async () => {
    const { server, stop } = await startService();
    try {
      const retry = outcomeOf(await server.assign(PRE_UPGRADE_ORDER, MARKET));
      const offline = await server.get(courierId(4));
      const a = outcomeOf(await server.assign(orders.a, MARKET));
      const b = outcomeOf(await server.assign(orders.b, MARKET));
      const none = outcomeOf(await server.assign(orderId(), MARKET));
      const far = outcomeOf(await server.assign(orders.far, FAR_MARKET));
      const released = await server.release(PRE_UPGRADE_ORDER);

      expect(retry).toMatchObject({ kind: 'atandi', courierId: courierId(3) });
      expect(offline.response?.courier?.status).toBe(
        courierV1.CourierStatus.COURIER_STATUS_OFFLINE,
      );
      // 1 seed aninda, 2 yarim saat sonra bosalmis: en uzun suredir bosta olan once.
      expect([a, b]).toMatchObject([
        { kind: 'atandi', courierId: courierId(1) },
        { kind: 'atandi', courierId: courierId(2) },
      ]);
      expect(none).toMatchObject({ kind: 'hata', grpc: GRPC_STATUS.NOT_FOUND });
      expect(far).toMatchObject({ kind: 'atandi', courierId: courierId(5) });
      expect(released.response).toEqual({ released: true, courierId: courierId(3) });
      expect(await indexNames()).toEqual([
        '_id_',
        'currentOrderId_unique',
        'lastLocation_2dsphere_status',
      ]);
    } finally {
      await stop();
    }
  });

  it('2. komut satiri: status uygulandi der; down T13.1 bicimine doner, atamalar ve konumlar korunur; ikinci down bos gecer', async () => {
    const status = await runCourierCli(CLI_ENTRY.MIGRATE, ['status'], mongo());
    const down = await runCourierCli(CLI_ENTRY.MIGRATE, ['down'], mongo());
    const documents = await byId();
    const markets = await raw.db(DB_NAME).listCollections({ name: COLLECTIONS.MARKETS }).toArray();
    const indexes = await indexNames();
    const downAgain = await runCourierCli(CLI_ENTRY.MIGRATE, ['down'], mongo());

    expect(status.code, status.output).toBe(0);
    expect(logLine(status.output, 'goc durumu')).toMatchObject({ pending: [] });
    expect(JSON.stringify(logLine(status.output, 'goc durumu')?.['applied'])).toContain(MIGRATION);
    expect(down.code, down.output).toBe(0);
    expect(logLine(down.output, 'goc down bitti')).toMatchObject({ reverted: MIGRATION });
    expect(downAgain.code, downAgain.output).toBe(0);
    expect(logLine(downAgain.output, 'geri alinacak goc yok')).toMatchObject({ reverted: null });
    expect(markets).toHaveLength(0);
    expect(indexes).not.toContain('lastLocation_2dsphere_status');
    const expected: Record<string, Document> = {
      [courierId(1)]: { marketId: MARKET, status: 'BUSY', currentOrderId: orders.a },
      [courierId(2)]: { marketId: MARKET, status: 'BUSY', currentOrderId: orders.b },
      [courierId(3)]: { marketId: MARKET, status: 'IDLE' },
      [courierId(4)]: { marketId: MARKET, status: 'OFFLINE' },
      [courierId(5)]: { marketId: FAR_MARKET, status: 'BUSY', currentOrderId: orders.far },
    };
    for (const original of LEGACY) {
      const id = String(original._id);
      const document = documents.get(id);
      expect(document, id).toMatchObject({
        ...expected[id],
        lastLocation: original['lastLocation'] as Document,
      });
      expect(Object.keys(document ?? {}), id).not.toContain('idleSince');
      expect(Object.keys((document?.['lastLocation'] as Document | undefined) ?? {}), id).toEqual([
        'lat',
        'lng',
      ]);
    }
    expect(Object.keys(documents.get(courierId(3)) ?? {})).not.toContain('currentOrderId');
  });

  it('3. up yeniden havuz bicimine cevirir, ikinci up bos gecer; servis yeniden acilinca atamalar ayni ve havuz calisir', async () => {
    const up = await runCourierCli(CLI_ENTRY.MIGRATE, ['up'], mongo());
    const documents = await byId();
    const marketCount = await raw.db(DB_NAME).collection(COLLECTIONS.MARKETS).countDocuments();
    const upAgain = await runCourierCli(CLI_ENTRY.MIGRATE, ['up'], mongo());

    expect(up.code, up.output).toBe(0);
    expect(JSON.stringify(logLine(up.output, 'goc up bitti')?.['applied'])).toContain(MIGRATION);
    expect(upAgain.code, upAgain.output).toBe(0);
    expect(logLine(upAgain.output, 'goc up bitti')).toMatchObject({ applied: [] });
    expect(marketCount).toBe(21);
    for (const [id, document] of documents) {
      expect(Object.keys(document), id).not.toContain('marketId');
      expect((document['lastLocation'] as Document | undefined)?.['type'], id).toBe('Point');
    }
    expect(Object.keys(documents.get(courierId(3)) ?? {})).toContain('idleSince');
    expect(Object.keys(documents.get(courierId(1)) ?? {})).not.toContain('idleSince');

    const { server, stop } = await startService();
    try {
      const retryA = outcomeOf(await server.assign(orders.a, MARKET));
      const next = outcomeOf(await server.assign(orderId(), MARKET));

      expect(retryA).toMatchObject({ kind: 'atandi', courierId: courierId(1) });
      expect(next).toMatchObject({ kind: 'atandi', courierId: courierId(3) });
    } finally {
      await stop();
    }
  });
});
