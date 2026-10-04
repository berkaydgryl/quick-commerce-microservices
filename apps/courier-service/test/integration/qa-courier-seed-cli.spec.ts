/**
 * QA kara kutu (T13.1): kurye seed'i GERCEK KOMUT olarak (`node dist/seed.js`,
 * `pnpm --filter @getir/courier-service seed`'in kostugu dosya), gercek Mongo'ya.
 * Komut yalnizca ortam degiskenleriyle yonetilir; sonuc cikis kodundan, gunluk
 * satirlarindan ve veritabanindan okunur.
 *
 * Beklenen (T13.1): katalogdaki 21 markete 3'er kurye = 63; hepsi IDLE, hic
 * atanmamis, marketinin konumunda. Tekrar kosmak sifirlar; production reddeder ve
 * canli atamalara dokunmaz. Kuryenin adi gunluge yazilmaz.
 *
 * CI'da `pnpm build` entegrasyon testlerinden once kosar; yerelde once derleyin.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { fixedClock, ID_PREFIX, newId, silentLogger } from '@getir/core';
import { connectMongo } from '@getir/mongo-kit';
import type { MongoConnection } from '@getir/mongo-kit';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { MARKETS } from '../../../catalog-service/src/infrastructure/fixtures/markets.js';
import { openCourierStore } from '../../src/infrastructure/courier-store.js';
import type { CourierDocument } from '../../src/infrastructure/mongo/documents.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import { NOW_MS } from '../support/couriers.js';
import {
  DEMO_COURIER_COUNT,
  DEMO_COURIERS_PER_MARKET,
  DEMO_MARKET_COUNT,
  isNotFound,
  outcomeOf,
  startQaCourierServer,
} from '../support/qa-courier-harness.js';

const MONGO_IMAGE = 'mongo:7';
const SEED_ENTRY = fileURLToPath(new URL('../../dist/seed.js', import.meta.url));
/** Komut bu surede bitmezse oldurulur (asili kalan surec testi kilitlemesin). */
const SEED_TIMEOUT_MS = 30_000;
const SEED_FAILURE_EXIT_CODE = 1;
/** Servisin deposu sureli acilir (#51); yuklu makinede yanlis kirmizi vermesin diye genis. */
const STORE_TIMEOUT_MS = 10_000;

let container: StartedMongoDBContainer;
let connection: MongoConnection;

function uri(): string {
  return `${container.getConnectionString()}/?directConnection=true`;
}

interface SeedRun {
  readonly code: number | null;
  /** stdout + stderr: gunluk JSON satirlari. */
  readonly output: string;
}

/** Seed komutunu verilen veritabani ve ortamla kosar. */
function runSeed(dbName: string, nodeEnv: 'development' | 'production'): Promise<SeedRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SEED_ENTRY], {
      env: {
        ...process.env,
        COURIER_MONGO_URI: uri(),
        COURIER_MONGO_DB: dbName,
        NODE_ENV: nodeEnv,
        LOG_LEVEL: 'info',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const collect = (chunk: Buffer): void => {
      output += chunk.toString('utf8');
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => child.kill('SIGKILL'), SEED_TIMEOUT_MS);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

const doneLineSchema = z
  .object({ msg: z.literal('kurye seed tamamlandi'), markets: z.number(), couriers: z.number() })
  .passthrough();

/** Gunlukteki "seed tamamlandi" satiri; yoksa undefined. */
function doneLine(output: string) {
  for (const line of output.split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    const parsed = doneLineSchema.safeParse(JSON.parse(line));
    if (parsed.success) return parsed.data;
  }
  return undefined;
}

const freshDb = (): string => `qa_courier_seed_${newId(ID_PREFIX.EVENT).slice(-8)}`;

function collection(dbName: string) {
  return connection.client.db(dbName).collection<CourierDocument>(COLLECTIONS.COURIERS);
}

beforeAll(async () => {
  if (!existsSync(SEED_ENTRY)) {
    throw new Error(`${SEED_ENTRY} yok: once "pnpm build" (CI'da entegrasyondan once kosar)`);
  }
  container = await new MongoDBContainer(MONGO_IMAGE).start();
  connection = await connectMongo({ uri: uri(), dbName: 'qa_courier_seed' });
});

afterAll(async () => {
  await connection?.close();
  await container?.stop();
});

describe('QA kurye seed komutu (node dist/seed.js, gercek Mongo)', () => {
  it('bos veritabanina 21 x 3 = 63 kurye: hepsi IDLE, atanmamis, marketinin konumunda; indeksler kurulu', async () => {
    const dbName = freshDb();

    const run = await runSeed(dbName, 'development');

    expect(run.code, run.output).toBe(0);
    expect(doneLine(run.output)).toMatchObject({
      markets: DEMO_MARKET_COUNT,
      couriers: DEMO_COURIER_COUNT,
    });
    const documents = await collection(dbName).find().toArray();
    expect(documents).toHaveLength(DEMO_COURIER_COUNT);
    expect(new Set(documents.map((document) => document._id)).size).toBe(DEMO_COURIER_COUNT);
    for (const document of documents) {
      expect(document._id).toMatch(/^crr_[0-9a-f]{32}$/);
      expect(document.status).toBe('IDLE');
      expect(Object.keys(document)).not.toContain('currentOrderId');
      expect(Object.keys(document)).not.toContain('lastAssignedAt');
      expect(document.name.trim()).not.toBe('');
    }
    for (const market of MARKETS) {
      const mine = documents.filter((document) => document.marketId === market.id);
      expect(mine, market.id).toHaveLength(DEMO_COURIERS_PER_MARKET);
      for (const document of mine) {
        expect(document.lastLocation).toEqual({ lat: market.lat, lng: market.lng });
      }
    }
    const indexes = (await collection(dbName).indexes()).map((index) => index.name).sort();
    expect(indexes).toEqual(['_id_', 'currentOrderId_unique', 'marketId_status_lastAssignedAt']);
    // Kisisel veri: komutun ciktisinda hicbir kuryenin adi yok.
    for (const document of documents) {
      expect(run.output).not.toContain(document.name);
    }
  });

  it('seed edilen veriyle servis acilir; her marketten tam 3 atama, 4. NOT_FOUND; tekrar seed atanmislari sifirlar', async () => {
    const dbName = freshDb();
    expect((await runSeed(dbName, 'development')).code).toBe(0);
    const before = new Set(
      (await collection(dbName).find().toArray()).map((document) => document._id),
    );
    const clock = fixedClock(NOW_MS);
    const store = await openCourierStore(
      { uri: uri(), dbName, serverSelectionTimeoutMs: 5_000, operationTimeoutMs: STORE_TIMEOUT_MS },
      { logger: silentLogger, clock },
    );
    const server = await startQaCourierServer({ repository: store.repository, clock });

    try {
      const requests = MARKETS.flatMap((market) =>
        Array.from({ length: DEMO_COURIERS_PER_MARKET + 1 }, () => ({
          marketId: market.id,
          order: newId(ID_PREFIX.ORDER),
        })),
      );
      const outcomes = (
        await Promise.all(requests.map(({ marketId, order }) => server.assign(order, marketId)))
      ).map(outcomeOf);

      for (const market of MARKETS) {
        const mine = outcomes.filter((_, index) => requests[index]?.marketId === market.id);
        expect(
          mine.filter((outcome) => outcome.kind === 'atandi'),
          market.id,
        ).toHaveLength(DEMO_COURIERS_PER_MARKET);
        expect(mine.filter(isNotFound), market.id).toHaveLength(1);
      }
      expect(await collection(dbName).countDocuments({ status: 'BUSY' })).toBe(DEMO_COURIER_COUNT);
    } finally {
      await server.stop();
      await store.close();
    }

    expect((await runSeed(dbName, 'development')).code).toBe(0);

    const after = await collection(dbName).find().toArray();
    expect(new Set(after.map((document) => document._id))).toEqual(before);
    expect(after.every((document) => document.status === 'IDLE')).toBe(true);
    expect(after.some((document) => document.currentOrderId !== undefined)).toBe(false);
  });

  it('NODE_ENV=production: cikis 1, bos veritabanina kurye yazilmaz, dolu veritabaninda canli atama bozulmaz', async () => {
    const empty = freshDb();
    const live = freshDb();
    expect((await runSeed(live, 'development')).code).toBe(0);
    const busyOrder = newId(ID_PREFIX.ORDER);
    await collection(live).updateOne(
      { status: 'IDLE' },
      { $set: { status: 'BUSY', currentOrderId: busyOrder, lastAssignedAt: new Date(NOW_MS) } },
    );
    const snapshot = await collection(live).find().sort({ _id: 1 }).toArray();

    const onEmpty = await runSeed(empty, 'production');
    const onLive = await runSeed(live, 'production');

    expect(onEmpty.code, onEmpty.output).toBe(SEED_FAILURE_EXIT_CODE);
    expect(onLive.code, onLive.output).toBe(SEED_FAILURE_EXIT_CODE);
    expect(doneLine(onLive.output)).toBeUndefined();
    expect(await collection(empty).countDocuments()).toBe(0);
    expect(await collection(live).find().sort({ _id: 1 }).toArray()).toEqual(snapshot);
    expect(await collection(live).countDocuments({ currentOrderId: busyOrder })).toBe(1);
  });
});
