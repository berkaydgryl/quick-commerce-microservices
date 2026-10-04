/**
 * QA kara kutu (T13.2 PR 1): kurulum SIRASI. Kullanici yerelde seed'i servisi acmadan
 * once de sonra da kosabilir; veritabani bos da T13.1 bicimli de olabilir. Her sirada
 * sonuc ayni olmali: 63 kurye havuz biciminde, 21 market kopyasi, goc kaydi, atama calisir.
 *
 *   1. Once seed (node dist/seed.js), sonra servis acilisi: goc 0001 yeni bicimli veriye
 *      dokunmaz (belgeler bayt bayt ayni), kaydi duser.
 *   2. Once acilis (bos veritabani), sonra seed: acilista kurye yok ama market biliniyor
 *      ("market bilinmiyor" degil, "kurye yok"); seed'den sonra atama calisir.
 *   3. T13.1 bicimli veritabanina seed: seed eski belgelerin uzerinde basarili; acilista
 *      eski indeks duser, atama calisir.
 *
 * Seed ciktisinin bicimi ve semt sayilari qa-courier-seed-cli.spec.ts'te; burada yinelenmez.
 */

import { ERROR_CODES, fixedClock, GRPC_STATUS, ID_PREFIX, newId, silentLogger } from '@getir/core';
import { appErrorOf } from '@getir/service-kit/testing';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { MongoClient } from 'mongodb';
import type { Document } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { openCourierStore } from '../../src/infrastructure/courier-store.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import { MARKET, MARKET_LOCATION, NOW_MS, orderId, SEEDED_AT } from '../support/couriers.js';
import { DEMO_COURIER_COUNT, DEMO_MARKET_COUNT } from '../support/qa-courier-harness.js';
import { assertBuilt, CLI_ENTRY, logLine, runCourierCli } from '../support/qa-cli.js';
import { outcomeOf, startQaCourierServer } from '../support/qa-courier-harness.js';

const MONGO_IMAGE = 'mongo:7';
const STORE_TIMEOUT_MS = 10_000;
const OLD_ASSIGNMENT_INDEX = 'marketId_status_lastAssignedAt';
const POOL_INDEX = 'lastLocation_2dsphere_status';
const MIGRATION = '1 kurye-havuzu';

let container: StartedMongoDBContainer;
let raw: MongoClient;

const mongoOf = (dbName: string) => ({
  uri: `${container.getConnectionString()}/?directConnection=true`,
  dbName,
});
const freshDb = (): string => `qa_kurulum_${newId(ID_PREFIX.EVENT).slice(-8)}`;
const couriersOf = (dbName: string) => raw.db(dbName).collection<Document>(COLLECTIONS.COURIERS);

/** Servisin acilis yolu (goc + indeks) ve gRPC sunucusu. */
async function startService(dbName: string) {
  const clock = fixedClock(NOW_MS);
  const store = await openCourierStore(
    { ...mongoOf(dbName), serverSelectionTimeoutMs: 5_000, operationTimeoutMs: STORE_TIMEOUT_MS },
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

async function seed(dbName: string): Promise<void> {
  const run = await runCourierCli(CLI_ENTRY.SEED, [], mongoOf(dbName));
  expect(run.code, run.output).toBe(0);
}

async function migrationStatus(dbName: string) {
  const run = await runCourierCli(CLI_ENTRY.MIGRATE, ['status'], mongoOf(dbName));
  expect(run.code, run.output).toBe(0);
  return logLine(run.output, 'goc durumu');
}

async function indexNames(dbName: string): Promise<string[]> {
  return (await couriersOf(dbName).indexes()).map((index) => String(index.name)).sort();
}

beforeAll(async () => {
  assertBuilt();
  container = await new MongoDBContainer(MONGO_IMAGE).start();
  raw = await MongoClient.connect(mongoOf('admin').uri);
});

afterAll(async () => {
  await raw?.close();
  await container?.stop();
});

describe('QA T13.2 kurulum sirasi: seed ve servis acilisi', () => {
  it('1. once seed, sonra acilis: goc yeni bicimli veriye dokunmaz, kaydi duser; atama calisir', async () => {
    const dbName = freshDb();
    await seed(dbName);
    const before = await couriersOf(dbName).find().sort({ _id: 1 }).toArray();

    const { server, stop } = await startService(dbName);
    try {
      const after = await couriersOf(dbName).find().sort({ _id: 1 }).toArray();
      const assigned = outcomeOf(await server.assign(orderId(), MARKET));

      expect(before).toHaveLength(DEMO_COURIER_COUNT);
      expect(after).toEqual(before);
      expect(assigned.kind).toBe('atandi');
    } finally {
      await stop();
    }
    const status = await migrationStatus(dbName);
    expect(JSON.stringify(status?.['applied'])).toContain(MIGRATION);
    expect(status).toMatchObject({ pending: [] });
    expect(await raw.db(dbName).collection(COLLECTIONS.MARKETS).countDocuments()).toBe(
      DEMO_MARKET_COUNT,
    );
  });

  it('2. once acilis (bos), sonra seed: acilista market biliniyor ama kurye yok; seed sonrasi atama calisir', async () => {
    const dbName = freshDb();
    const empty = await startService(dbName);
    let beforeSeed;
    try {
      beforeSeed = await empty.server.assign(orderId(), MARKET);
    } finally {
      await empty.stop();
    }
    await seed(dbName);
    const seeded = await startService(dbName);
    try {
      const assigned = outcomeOf(await seeded.server.assign(orderId(), MARKET));

      expect(beforeSeed.error?.code).toBe(GRPC_STATUS.NOT_FOUND);
      // Goc market kopyasini yazdi: "market bilinmiyor" degil, "kurye yok".
      expect(appErrorOf(beforeSeed.error)).toEqual({
        code: ERROR_CODES.NOT_FOUND,
        details: { marketId: MARKET },
      });
      expect(assigned.kind).toBe('atandi');
      expect(await couriersOf(dbName).countDocuments()).toBe(DEMO_COURIER_COUNT);
    } finally {
      await seeded.stop();
    }
  });

  it('3. T13.1 bicimli veritabanina seed: eski belgelerin uzerine basarili; acilista eski indeks duser, atama calisir', async () => {
    const dbName = freshDb();
    const legacy: Document[] = [
      {
        _id: `crr_${'a'.repeat(32)}`,
        name: 'Eski Kurye',
        marketId: MARKET,
        status: 'BUSY',
        currentOrderId: orderId(),
        lastAssignedAt: SEEDED_AT,
        lastLocation: { lat: MARKET_LOCATION.lat, lng: MARKET_LOCATION.lng },
        lastLocationAt: SEEDED_AT,
      },
      {
        _id: `crr_${'b'.repeat(32)}`,
        name: 'Eski Kurye 2',
        marketId: MARKET,
        status: 'IDLE',
        lastLocation: { lat: MARKET_LOCATION.lat, lng: MARKET_LOCATION.lng },
        lastLocationAt: SEEDED_AT,
      },
    ];
    await couriersOf(dbName).insertMany(legacy);
    await couriersOf(dbName).createIndex(
      { marketId: 1, status: 1, lastAssignedAt: 1, _id: 1 },
      { name: OLD_ASSIGNMENT_INDEX },
    );

    await seed(dbName);
    const afterSeed = await couriersOf(dbName).find().toArray();
    const { server, stop } = await startService(dbName);
    try {
      const assigned = outcomeOf(await server.assign(orderId(), MARKET));

      expect(afterSeed).toHaveLength(DEMO_COURIER_COUNT);
      for (const document of afterSeed) {
        expect(Object.keys(document), String(document._id)).not.toContain('marketId');
        expect((document['lastLocation'] as Document | undefined)?.['type']).toBe('Point');
      }
      expect(await indexNames(dbName)).toEqual(['_id_', 'currentOrderId_unique', POOL_INDEX]);
      expect(assigned.kind).toBe('atandi');
    } finally {
      await stop();
    }
  });
});
