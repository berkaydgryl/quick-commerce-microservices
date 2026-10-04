/**
 * QA kara kutu (T13.1): kurye seed'i GERCEK KOMUT olarak (`node dist/seed.js`,
 * `pnpm --filter @getir/courier-service seed`'in kostugu dosya), gercek Mongo'ya.
 * Komut yalnizca ortam degiskenleriyle yonetilir; sonuc cikis kodundan, gunluk
 * satirlarindan ve veritabanindan okunur.
 *
 * Beklenen (T13.1; havuz T13.2): katalogdaki 21 marketin yakinina 3'er kurye = 63;
 * hepsi IDLE, hic atanmamis, bosta beklemesi seed aninda baslamis, markete bagli
 * degil; 21 marketin konumu kopyada. Tekrar kosmak sifirlar; production reddeder ve
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
import { distanceMeters } from '../../src/domain/geo.js';
import { openCourierStore } from '../../src/infrastructure/courier-store.js';
import type { CourierDocument, MarketDocument } from '../../src/infrastructure/mongo/documents.js';
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

function marketCopy(dbName: string) {
  return connection.client.db(dbName).collection<MarketDocument>(COLLECTIONS.MARKETS);
}

/** Demo verisinde Kadikoy 41. enlemin guneyinde, Besiktas kuzeyinde. */
const isKadikoy = (point: { readonly lat: number }): boolean => point.lat < 41;

/** GeoJSON [boylam, enlem] -> {lat, lng}. */
const pointOf = (document: CourierDocument) => {
  const [lng = 0, lat = 0] = document.lastLocation.coordinates;
  return { lat, lng };
};

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
  it('bos veritabanina 63 kurye (her marketin yakininda 3) ve 21 market konumu: hepsi IDLE, atanmamis, markete bagli degil; indeksler kurulu', async () => {
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
      expect(document.idleSince).toBeInstanceOf(Date);
      expect(document.lastLocation.type).toBe('Point');
      expect(Object.keys(document)).not.toContain('currentOrderId');
      expect(Object.keys(document)).not.toContain('lastAssignedAt');
      expect(Object.keys(document)).not.toContain('marketId');
      expect(document.name.trim()).not.toBe('');
    }
    for (const market of MARKETS) {
      const close = documents.filter((document) => {
        const distance = distanceMeters(market, pointOf(document));
        return distance >= 39 && distance <= 151;
      });
      expect(close.length, market.id).toBeGreaterThanOrEqual(DEMO_COURIERS_PER_MARKET);
    }
    const copies = await marketCopy(dbName).find().toArray();
    expect(
      copies
        .map((copy) => ({
          id: copy._id,
          lat: copy.location.coordinates[1],
          lng: copy.location.coordinates[0],
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    ).toEqual(
      MARKETS.map((market) => ({ id: market.id, lat: market.lat, lng: market.lng })).sort(
        (left, right) => left.id.localeCompare(right.id),
      ),
    );
    const indexes = (await collection(dbName).indexes()).map((index) => index.name).sort();
    expect(indexes).toEqual(['_id_', 'currentOrderId_unique', 'lastLocation_2dsphere_status']);
    // Kisisel veri: komutun ciktisinda hicbir kuryenin adi yok.
    for (const document of documents) {
      expect(run.output).not.toContain(document.name);
    }
  });

  it('seed edilen veriyle servis acilir; her semt kendi kuryesi kadar atar, fazlasi NOT_FOUND; tekrar seed atanmislari sifirlar', async () => {
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
    const server = await startQaCourierServer({
      repository: store.repository,
      markets: store.markets,
      clock,
    });

    try {
      const requests = MARKETS.flatMap((market) =>
        Array.from({ length: DEMO_COURIERS_PER_MARKET + 1 }, () => ({
          market,
          order: newId(ID_PREFIX.ORDER),
        })),
      );
      const outcomes = (
        await Promise.all(requests.map(({ market, order }) => server.assign(order, market.id)))
      ).map(outcomeOf);

      for (const kadikoy of [true, false]) {
        const marketCount = MARKETS.filter((market) => isKadikoy(market) === kadikoy).length;
        const mine = outcomes.filter((_, index) => {
          const market = requests[index]?.market;
          return market !== undefined && isKadikoy(market) === kadikoy;
        });
        expect(mine.filter((outcome) => outcome.kind === 'atandi')).toHaveLength(
          marketCount * DEMO_COURIERS_PER_MARKET,
        );
        expect(mine.filter(isNotFound)).toHaveLength(marketCount);
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
