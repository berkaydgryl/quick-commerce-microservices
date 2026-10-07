/**
 * QA PQ6 (T15.2, payment geriye donuk PR 2): payment'in GERCEK sureci (dist/main.js, dist/migrate.js)
 * gercek Mongo ve Redis'le (Testcontainers), IQ6 deseni. Surec baslatici inventory'nin QA
 * yardimcisindan (startProcess, runEntry; ortaklasma bekleyen is #106).
 *
 *   a) MOCK=true: Mongo ve Redis olmadan acilir (bellek, olay dinleme kapali).
 *   b) ortam hatasi: Mongo adresi yok, port bicimsiz -> acilmaz, cikis 1, sebep gunlukte.
 *   c) bagimli yok: Mongo ya da Redis ulasilamaz -> askida kalmaz, butce icinde cikar.
 *   d) iki kopya ayni anda bos veritabanina acilir: gocler ve indeksler yarismaz, ikisi de hazir.
 *   e) migrate komutu: status, up (iki kez), down; bilinmeyen komut 2, Mongo adresi yok 1.
 *   f) SIGTERM: hazir surec zarif kapanir, cikis 0.
 *
 * CI'da `pnpm build` entegrasyon testlerinden once kosar; yerelde once derleyin.
 */

import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

import { connectMongo } from '@getir/mongo-kit';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  logLines,
  runEntry,
  startProcess,
  stopAllProcesses,
} from '../../../inventory-service/test/support/qa-inventory-process.js';
import type { RunningProcess } from '../../../inventory-service/test/support/qa-inventory-process.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import { MIGRATIONS } from '../../src/migrations/index.js';
import { directUri, startContainer } from '../support/qa-payment-cluster.js';

const MAIN = fileURLToPath(new URL('../../dist/main.js', import.meta.url));
const MIGRATE = fileURLToPath(new URL('../../dist/migrate.js', import.meta.url));
const READY = 'odeme servisi hazir';
const PORT_ENV = 'PAYMENT_GRPC_PORT';
const CONTAINER_START_TIMEOUT_MS = 120_000;
const TEST_TIMEOUT_MS = 60_000;
/** Ulasilamayan bagimlida bekleme siniri: surec bu sureyi asarsa askida demektir. */
const UNREACHABLE_BUDGET_MS = 15_000;

let mongo: StartedMongoDBContainer;
let redis: StartedRedisContainer;
let databases = 0;

beforeAll(async () => {
  if (!existsSync(MAIN) || !existsSync(MIGRATE)) {
    throw new Error('payment dist yok: once "pnpm build" (CI entegrasyondan once kosar)');
  }
  // Sirayla: Docker bellek siniri altinda iki konteyner ayni anda acilmasin.
  mongo = await startContainer('Mongo', () => new MongoDBContainer('mongo:7').start());
  redis = await startContainer('Redis', () => new RedisContainer('redis:7-alpine').start());
}, CONTAINER_START_TIMEOUT_MS);

afterEach(async () => {
  await stopAllProcesses();
});

afterAll(async () => {
  await Promise.allSettled([mongo?.stop(), redis?.stop()]);
});

/** Uretim ortami (MOCK kapali), taze veritabaniyla; `overrides` son sozu soyler. */
function serviceEnv(overrides: Record<string, string> = {}): Record<string, string> {
  databases += 1;
  return {
    NODE_ENV: 'development',
    LOG_LEVEL: 'info',
    MOCK: 'false',
    PAYMENT_MONGO_URI: directUri(mongo.getConnectionString()),
    PAYMENT_MONGO_DB: `qa_payment_process_${databases}`,
    REDIS_URL: redis.getConnectionUrl(),
    ...overrides,
  };
}

function start(env: Record<string, string>): Promise<RunningProcess> {
  return startProcess({ entry: MAIN, readyMessage: READY, portEnv: PORT_ENV, env });
}

/** Dinlenmeyen bir port: baglanti reddedilir (ulasilamayan bagimli). */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function withoutKey(env: Record<string, string>, key: string): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter(([name]) => name !== key));
}

describe('QA PQ6 payment sureci: acilis, ortam, bagimli ve kapanis', () => {
  it(
    'a) MOCK=true: Mongo ve Redis olmadan acilir; bellek deposu, olay dinleme kapali',
    async () => {
      const running = await start({ NODE_ENV: 'development', LOG_LEVEL: 'info', MOCK: 'true' });

      expect(running.ready).toBe(true);
      expect(logLines(running.output(), READY)[0]).toMatchObject({
        mock: true,
        storage: 'bellek (MOCK)',
        events: 'kapali (MOCK)',
      });
    },
    TEST_TIMEOUT_MS,
  );

  it.each([
    [
      'Mongo adresi yok',
      (env: Record<string, string>) => withoutKey(env, 'PAYMENT_MONGO_URI'),
      'PAYMENT_MONGO_URI',
    ],
    [
      'Redis adresi yok',
      (env: Record<string, string>) => withoutKey(env, 'REDIS_URL'),
      'REDIS_URL',
    ],
    ['port bicimsiz', (env: Record<string, string>) => ({ ...env, [PORT_ENV]: 'abc' }), PORT_ENV],
  ])(
    'b) ortam hatasi (%s): acilmaz, cikis 1, sebep gunlukte',
    async (_label, mutate, key) => {
      const running = await start(mutate(serviceEnv()));

      expect(running.ready).toBe(false);
      expect(running.exitCode).toBe(1);
      expect(running.output()).toContain(key);
    },
    TEST_TIMEOUT_MS,
  );

  it.each([
    [
      'Mongo',
      async (env: Record<string, string>) => ({
        ...env,
        PAYMENT_MONGO_URI: `mongodb://127.0.0.1:${await closedPort()}/?directConnection=true`,
        MONGO_SERVER_SELECTION_TIMEOUT_MS: '1000',
      }),
    ],
    [
      'Redis',
      async (env: Record<string, string>) => ({
        ...env,
        REDIS_URL: `redis://127.0.0.1:${await closedPort()}`,
        REDIS_CONNECT_TIMEOUT_MS: '1000',
      }),
    ],
  ])(
    'c) %s ulasilamaz: askida kalmaz, butce icinde sifir olmayan kodla cikar',
    async (_label, mutate) => {
      const running = await start(await mutate(serviceEnv()));

      expect(running.ready).toBe(false);
      expect(running.exitCode).not.toBe(0);
      expect(running.exitCode).not.toBeNull();
      expect(running.elapsedMs).toBeLessThan(UNREACHABLE_BUDGET_MS);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'd) iki kopya ayni anda bos veritabanina: ikisi de hazir, indeksler tek ve unique',
    async () => {
      const env = serviceEnv();
      const [first, second] = await Promise.all([start(env), start(env)]);

      expect([first.ready, second.ready]).toEqual([true, true]);
      for (const running of [first, second]) {
        expect(logLines(running.output(), READY)[0]).toMatchObject({
          storage: 'mongo',
          events: 'redis',
        });
      }
      const connection = await connectMongo({
        uri: env.PAYMENT_MONGO_URI ?? '',
        dbName: env.PAYMENT_MONGO_DB ?? '',
        appName: 'qa-payment-process',
      });
      try {
        const indexes = await connection.db.collection(COLLECTIONS.PAYMENTS).indexes();
        const unique = indexes.filter((index) => index.unique === true).map((index) => index.key);
        expect(unique).toEqual(expect.arrayContaining([{ orderId: 1 }, { idempotencyKey: 1 }]));
        // Ayni anahtara ikinci indeks (baska adla) yok: iki kopyanin ensureIndexes'i yarismadi.
        const keys = indexes.map((index) => JSON.stringify(index.key));
        expect(new Set(keys).size).toBe(keys.length);
      } finally {
        await connection.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'e) migrate: status ve up (iki kez) 0, down 0; bilinmeyen komut 2, Mongo adresi yok 1',
    async () => {
      // Payment'in bugun gocu YOK: bu test yalniz komut sozlesmesini (cikis kodlari) sinar. Goc
      // eklenince kirmizi olur: up'in uyguladigini ve down'un geri aldigini da denetleyin.
      expect(MIGRATIONS).toHaveLength(0);
      const env = serviceEnv();
      for (const command of ['status', 'up', 'up', 'down', 'status']) {
        const run = await runEntry(MIGRATE, [command], env);
        expect({ command, code: run.code }).toEqual({ command, code: 0 });
      }
      expect((await runEntry(MIGRATE, ['yana'], env)).code).toBe(2);
      expect((await runEntry(MIGRATE, [], env)).code).toBe(2);
      const missing = await runEntry(MIGRATE, ['status'], withoutKey(env, 'PAYMENT_MONGO_URI'));
      expect(missing.code).toBe(1);
      expect(missing.output).toContain('PAYMENT_MONGO_URI');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'f) SIGTERM: hazir surec zarif kapanir, cikis 0',
    async () => {
      const running = await start(serviceEnv());
      expect(running.ready).toBe(true);

      const closed = new Promise<number | null>((resolve) => running.child.once('close', resolve));
      running.child.kill('SIGTERM');

      // Cikis kodu tek basina kanit degil: kapanis hata verse de surec 0 ile cikar (shutdown.ts).
      // Zarif kapanis = sunucu cagrilari bosaltti (zorla degil), kanca (olay dinleme, Mongo) bitti,
      // hicbir ERROR yok.
      expect(await closed).toBe(0);
      const output = running.output();
      expect(logLines(output, 'zarif kapanis bitti')[0]).toMatchObject({
        forced: false,
        hook: 'done',
      });
      expect(output).not.toContain('"level":"error"');
    },
    TEST_TIMEOUT_MS,
  );
});
