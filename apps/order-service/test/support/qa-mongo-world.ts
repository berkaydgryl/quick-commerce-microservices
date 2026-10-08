/**
 * QA (T13.2 PR 2): order ve courier GERCEK Mongo'da (Testcontainers, servis basina
 * ayri veritabani, D14), courier surec icinde gercek gRPC sunucusuyla. Order'in
 * komutlari (dist/migrate.js) gercek surec olarak kosar.
 *
 * qa-courier-world.ts'in Mongo eki: courier modeline dokunan yer yine yalnizca
 * placeCouriers ve courier'in kendi seed yazicisi.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ORDER_STATUS, silentLogger } from '@getir/core';
import type { MutableClock } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { connectMongo } from '@getir/mongo-kit';
import type { MongoClient } from 'mongodb';
import { z } from 'zod';

import type { Courier } from '../../../courier-service/src/domain/courier.js';
import { openCourierStore } from '../../../courier-service/src/infrastructure/courier-store.js';
import { MARKET_LOCATION_SEEDS } from '../../../courier-service/src/infrastructure/fixtures/couriers.js';
import { CouriersCollection } from '../../../courier-service/src/infrastructure/mongo/couriers-collection.js';
import { MarketsCollection } from '../../../courier-service/src/infrastructure/mongo/markets-collection.js';
import { MongoCourierSeedWriter } from '../../../courier-service/src/infrastructure/mongo/mongo-courier-seed-writer.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import { openOrderStore } from '../../src/infrastructure/order-store.js';
import { HookedCourierRepository, orderSide, startCourierService } from './qa-courier-world.js';
import type { QaCourierService, QaOrderSide, FREE_FIXED_PORT } from './qa-courier-world.js';

/** Uretimdeki gibi sureli, yuklu makinede yanlis kirmizi vermesin diye genis. */
export const STORE_TIMEOUT_MS = 10_000;

export type Cleanups = (() => Promise<void> | void)[];

export interface CourierSide {
  readonly service: QaCourierService;
  readonly hooks: HookedCourierRepository;
}

/**
 * courier-svc kendi Mongo veritabaninda, uretimdeki sirayla: once seed komutunun
 * yazdigi (indeks + kuryeler + demo market kopyasi), sonra servisin acilisi
 * (openCourierStore: gocler + indeksler) ve gercek gRPC sunucusu.
 */
export async function courierOnMongo(options: {
  readonly uri: string;
  readonly dbName: string;
  /** Verilmezse seed YOK: coken courier ayni veriyle geri gelir. */
  readonly placed?: readonly Courier[];
  readonly clock: MutableClock;
  readonly lines?: LogLine[];
  readonly port?: number | typeof FREE_FIXED_PORT;
  readonly cleanups: Cleanups;
}): Promise<CourierSide> {
  const mongo = { uri: options.uri, dbName: options.dbName, operationTimeoutMs: STORE_TIMEOUT_MS };
  if (options.placed !== undefined) {
    await seedCouriers(mongo, options.placed);
  }
  const logger = options.lines === undefined ? silentLogger : recordingLogger(options.lines);
  const store = await openCourierStore(
    { ...mongo, serverSelectionTimeoutMs: 5_000 },
    { logger, clock: options.clock },
  );
  options.cleanups.push(() => store.close());
  const hooks = new HookedCourierRepository(store.repository);
  const service = await startCourierService({
    repository: hooks,
    // Uretimdeki gibi market kopyasi ve rotalar da Mongo'da (T13.2 PR 3).
    markets: store.markets,
    routes: store.routes,
    clock: options.clock,
    logger,
    ...(options.port === undefined ? {} : { port: options.port }),
  });
  options.cleanups.push(() => service.stop());
  return { service, hooks };
}

/** courier'in seed komutunun yaptigi: once indeks, sonra kuryeler ve market kopyasi (tek transaction). */
async function seedCouriers(
  mongo: { readonly uri: string; readonly dbName: string; readonly operationTimeoutMs: number },
  placed: readonly Courier[],
): Promise<void> {
  const seed = await connectMongo(mongo);
  try {
    const couriers = new CouriersCollection(seed.db);
    await couriers.ensureIndexes();
    await new MongoCourierSeedWriter(seed, couriers, new MarketsCollection(seed.db)).replaceAll(
      placed,
      MARKET_LOCATION_SEEDS,
    );
  } finally {
    await seed.close();
  }
}

/** order servisinin acilis yoluyla (openOrderStore: gocler + indeksler) ve uretimdeki courier istemcisiyle. */
export async function orderOnMongo(options: {
  readonly uri: string;
  readonly dbName: string;
  readonly courierAddress: string;
  readonly clock: MutableClock;
  readonly lines?: LogLine[];
  readonly operationTimeoutMs?: number;
  /** courier cagrisinin suresi (orderSide); verilmezse uretimdeki. */
  readonly courierCallTimeoutMs?: number;
  readonly cleanups: Cleanups;
}): Promise<QaOrderSide> {
  // Acilisin gunlugu (gocler) ve iscinin gunlugu ayni yere: servis tek surec.
  const logger = options.lines === undefined ? silentLogger : recordingLogger(options.lines);
  const store = await openOrderStore(
    {
      uri: options.uri,
      dbName: options.dbName,
      serverSelectionTimeoutMs: 5_000,
      operationTimeoutMs: options.operationTimeoutMs ?? STORE_TIMEOUT_MS,
    },
    logger,
    'test',
  );
  options.cleanups.push(() => store.close());
  const side = orderSide({
    store,
    courierAddress: options.courierAddress,
    clock: options.clock,
    logger,
    ...(options.courierCallTimeoutMs === undefined
      ? {}
      : { courierCallTimeoutMs: options.courierCallTimeoutMs }),
  });
  options.cleanups.push(() => side.close());
  return side;
}

/** Siparisin outbox'taki PAID -> PREPARING olaylari. */
export function preparingEvents(
  raw: MongoClient,
  dbName: string,
  orderId: string,
): Promise<number> {
  return raw.db(dbName).collection(COLLECTIONS.OUTBOX).countDocuments({
    aggregateId: orderId,
    topic: 'order.status_changed',
    'payload.from': ORDER_STATUS.PAID,
    'payload.to': ORDER_STATUS.PREPARING,
  });
}

/** courier'e ulasan AssignCourier istekleri (istek kimligine gore tekil). */
export function assignRequests(lines: readonly LogLine[]): number {
  return new Set(
    lines
      .filter((line) => line.fields.rpc === 'AssignCourier')
      .map((line) => line.fields.requestId),
  ).size;
}

const MIGRATE_ENTRY = fileURLToPath(new URL('../../dist/migrate.js', import.meta.url));
const CLI_TIMEOUT_MS = 30_000;

export function assertOrderBuilt(): void {
  if (!existsSync(MIGRATE_ENTRY)) {
    throw new Error(`${MIGRATE_ENTRY} yok: once "pnpm build" (CI'da entegrasyondan once kosar)`);
  }
}

export interface CliRun {
  readonly code: number | null;
  readonly output: string;
}

/** Order'in goc komutunu gercek surec olarak kosar. */
export function runOrderMigrate(
  command: string,
  mongo: { readonly uri: string; readonly dbName: string },
): Promise<CliRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [MIGRATE_ENTRY, command], {
      env: {
        ...process.env,
        ORDER_MONGO_URI: mongo.uri,
        ORDER_MONGO_DB: mongo.dbName,
        NODE_ENV: 'development',
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
    const timer = setTimeout(() => child.kill('SIGKILL'), CLI_TIMEOUT_MS);
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

const logLineSchema = z.object({ msg: z.string() }).passthrough();

/** Gunlukteki `msg`'si verilen ilk JSON satiri; yoksa undefined. */
export function logLine(output: string, msg: string): Record<string, unknown> | undefined {
  for (const line of output.split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    const parsed = logLineSchema.safeParse(JSON.parse(line));
    if (parsed.success && parsed.data.msg === msg) return parsed.data;
  }
  return undefined;
}

export type { QaOrderSide };
