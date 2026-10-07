/**
 * QA kara kutu (T15.2, order geriye donuk PR 2; OQ7): order'in GERCEK sureci (dist/main.js,
 * dist/migrate.js), gercek Mongo ve Redis (qa-payment-world useInventoryWorld: inventory gRPC'si
 * de gercek), bellek payment'i (qa-order-copy startPayment; ariza katmanli). payment PQ6 deseni;
 * surec baslatici inventory'nin QA yardimcisindan (ortaklasma bekleyen is #106).
 *
 *   P1 MOCK=true: Mongo ve Redis olmadan acilir; supurucu ve kurye iscisi baslar, yayinci kapali.
 *   P2 ortam hatasi (Mongo ya da Redis adresi yok, port bicimsiz, supurucu araligi sinir disi):
 *      acilmaz, cikis 1, sebep gunlukte.
 *   P3 Mongo ya da Redis ulasilamaz: askida kalmaz, butce icinde sifir olmayan kodla cikar.
 *   P4 iki kopya ayni anda bos veritabanina: ikisi de hazir, her goc BIR kopyada kosar (gunluk),
 *      kayitlar ve indeksler tek.
 *   P5 migrate: status, up (iki kez), down, up; kayit sayilari; bilinmeyen komut 2, adres yok 1.
 *   P6 SIGTERM, supurucunun turu payment'ta beklerken: sunucu bosaltildiktan sonra (kanca basladi)
 *      cevap verilir; kanca turun bitmesini bekler, tur siparisi KAPATIR (CANCELLED; iptalin olayi
 *      ve komutu outbox'ta), uc isci de baslamisti, kanca bitti, zorlanmadi, ERROR yok, cikis 0.
 *
 * CI'da `pnpm build` entegrasyon testlerinden once kosar; yerelde once derleyin.
 */

import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';

import { EVENTS, fixedClock, ORDER_STATUS, silentLogger } from '@getir/core';
import { connectMongo, MIGRATIONS_COLLECTION } from '@getir/mongo-kit';
import type { MigrationRecord } from '@getir/mongo-kit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  logLines,
  runEntry,
  startProcess,
  stopAllProcesses,
  waitUntil,
} from '../../../inventory-service/test/support/qa-inventory-process.js';
import type { RunningProcess } from '../../../inventory-service/test/support/qa-inventory-process.js';
import { InMemoryPaymentStore } from '../../../payment-service/src/infrastructure/memory/in-memory-payment-store.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import type { OutboxDocument } from '../../src/infrastructure/mongo/documents.js';
import { HISTORY_INDEX_NAME } from '../../src/infrastructure/mongo/history-query.js';
import { openOrderStore } from '../../src/infrastructure/order-store.js';
import { MIGRATIONS } from '../../src/migrations/index.js';
import { insertAwaitingPayment } from '../support/order-builders.js';
import { closeAll, startPayment } from '../support/qa-order-copy.js';
import type { Closers } from '../support/qa-order-copy.js';
import { PaymentFaults } from '../support/qa-payment-faults.js';
import { useInventoryWorld } from '../support/qa-payment-world.js';

const MAIN = fileURLToPath(new URL('../../dist/main.js', import.meta.url));
const MIGRATE = fileURLToPath(new URL('../../dist/migrate.js', import.meta.url));
const READY = 'siparis servisi hazir';
const PORT_ENV = 'ORDER_GRPC_PORT';
const TEST_TIMEOUT_MS = 60_000;
/** Ulasilamayan bagimlida bekleme siniri: surec bu sureyi asarsa askida demektir. */
const UNREACHABLE_BUDGET_MS = 15_000;
/** Supurucunun en kisa araligi (MIN_ORDER_SWEEPER_INTERVAL_MS): ilk tur hemen gelsin. */
const SWEEPER_INTERVAL_MS = '1000';
/** Yoklama butcesi: gunluk satiri ya da payment cagrisi bu surede gorunmeli. */
const SEEN_WITHIN_MS = 15_000;
/** Dinleyeni olmayan adres (port 1): baglanti hemen reddedilir; kullanilmayan bagimlilar burada. */
const UNREACHABLE_HOST = '127.0.0.1';
const UNREACHABLE_PORT = 1;
const UNREACHABLE = `${UNREACHABLE_HOST}:${String(UNREACHABLE_PORT)}`;
const WORKERS = [
  'kurye atayan isci basladi',
  'siparis supurucusu basladi',
  'outbox yayincisi basladi',
];

const world = useInventoryWorld('qa_order_surec');
const closers: Closers = [];
let databases = 0;

beforeAll(() => {
  if (!existsSync(MAIN) || !existsSync(MIGRATE)) {
    throw new Error('order dist yok: once "pnpm build" (CI entegrasyondan once kosar)');
  }
});

afterEach(async () => {
  await stopAllProcesses();
  await closeAll(closers.splice(0).reverse());
});

/**
 * Uretim ortami (MOCK kapali), taze veritabaniyla; kullanilmayan bagimlilar ulasilamaz adreste.
 * `overrides` son sozu soyler, `omit` degiskeni hic vermez.
 */
function serviceEnv(
  overrides: Record<string, string> = {},
  omit: readonly string[] = [],
): Record<string, string> {
  databases += 1;
  const env: Record<string, string> = {
    NODE_ENV: 'development',
    LOG_LEVEL: 'info',
    MOCK: 'false',
    ORDER_MONGO_URI: world.mongoUri(),
    ORDER_MONGO_DB: `qa_order_surec_${String(databases)}`,
    REDIS_URL: world.redisUrl(),
    CATALOG_GRPC_ADDR: UNREACHABLE,
    RISK_GRPC_ADDR: UNREACHABLE,
    PAYMENT_GRPC_ADDR: UNREACHABLE,
    INVENTORY_GRPC_ADDR: world.address(),
    COURIER_GRPC_ADDR: UNREACHABLE,
    ...overrides,
  };
  return Object.fromEntries(Object.entries(env).filter(([name]) => !omit.includes(name)));
}

function start(env: Record<string, string>): Promise<RunningProcess> {
  return startProcess({ entry: MAIN, readyMessage: READY, portEnv: PORT_ENV, env });
}

/** Sureci gRPC portu baglanti REDDEDIYOR mu (sunucu bosaltildi, kapanis kancasi basladi). */
function refuses(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(true));
  });
}

async function withDatabase<T>(
  env: Record<string, string>,
  use: (db: Awaited<ReturnType<typeof connectMongo>>['db']) => Promise<T>,
): Promise<T> {
  const connection = await connectMongo({
    uri: env['ORDER_MONGO_URI'] ?? '',
    dbName: env['ORDER_MONGO_DB'] ?? '',
    appName: 'qa-order-process',
  });
  try {
    return await use(connection.db);
  } finally {
    await connection.close();
  }
}

describe('QA OQ7 order sureci: acilis, ortam, gocler ve iscilerin zarif durmasi', () => {
  it(
    'P1 MOCK=true: Mongo ve Redis olmadan acilir; supurucu ve kurye iscisi baslar, yayinci kapali',
    async () => {
      const running = await start(serviceEnv({ MOCK: 'true' }, ['ORDER_MONGO_URI', 'REDIS_URL']));

      expect(running.ready).toBe(true);
      expect(logLines(running.output(), READY)[0]).toMatchObject({
        mock: true,
        storage: 'bellek (MOCK)',
        events: 'kapali (MOCK)',
      });
      expect(logLines(running.output(), WORKERS[0] ?? '')).toHaveLength(1);
      expect(logLines(running.output(), WORKERS[1] ?? '')).toHaveLength(1);
      expect(logLines(running.output(), WORKERS[2] ?? '')).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );

  it.each([
    ['Mongo adresi yok', {}, ['ORDER_MONGO_URI'], 'ORDER_MONGO_URI'],
    ['Redis adresi yok', {}, ['REDIS_URL'], 'REDIS_URL'],
    ['port bicimsiz', { [PORT_ENV]: 'abc' }, [], PORT_ENV],
    [
      'supurucu araligi alt sinirin altinda',
      { ORDER_SWEEPER_INTERVAL_MS: '999' },
      [],
      'ORDER_SWEEPER_INTERVAL_MS',
    ],
    [
      'supurucu araligi ust sinirin ustunde',
      { ORDER_SWEEPER_INTERVAL_MS: '600001' },
      [],
      'ORDER_SWEEPER_INTERVAL_MS',
    ],
  ] as const)(
    'P2 ortam hatasi (%s): acilmaz, cikis 1, sebep gunlukte',
    async (_label, overrides, omit, key) => {
      const running = await start(serviceEnv({ ...overrides }, omit));

      expect(running.ready).toBe(false);
      expect(running.exitCode).toBe(1);
      expect(running.output()).toContain(key);
    },
    TEST_TIMEOUT_MS,
  );

  it.each([
    [
      'Mongo',
      {
        ORDER_MONGO_URI: `mongodb://${UNREACHABLE}/?directConnection=true`,
        MONGO_SERVER_SELECTION_TIMEOUT_MS: '1000',
      },
    ],
    ['Redis', { REDIS_URL: `redis://${UNREACHABLE}`, REDIS_CONNECT_TIMEOUT_MS: '1000' }],
  ] as const)(
    'P3 %s ulasilamaz: askida kalmaz, butce icinde sifir olmayan kodla cikar',
    async (_label, overrides) => {
      const running = await start(serviceEnv({ ...overrides }));

      expect(running.ready).toBe(false);
      expect(running.exitCode).not.toBe(0);
      expect(running.exitCode).not.toBeNull();
      expect(running.elapsedMs).toBeLessThan(UNREACHABLE_BUDGET_MS);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'P4 iki kopya ayni anda bos veritabanina: ikisi de hazir, her goc bir kez, indeksler tek',
    async () => {
      const env = serviceEnv();
      const [first, second] = await Promise.all([start(env), start(env)]);

      expect([first.ready, second.ready]).toEqual([true, true]);
      // Her goc yalniz BIR kopyada kostu (kayit kimligi zaten tekil; asil kanit gunluk): digeri
      // kilidi bekledi ya da gocleri guncel buldu.
      const applies = [first, second].flatMap((running) =>
        logLines(running.output(), 'goc uygulandi'),
      );
      expect(applies).toHaveLength(MIGRATIONS.length);
      await withDatabase(env, async (db) => {
        const applied = await db
          .collection<MigrationRecord>(MIGRATIONS_COLLECTION)
          .find({})
          .toArray();
        expect(applied.map((record) => record.name)).toEqual(
          MIGRATIONS.map((migration) => migration.name),
        );
        // Indeksin kimligi anahtar + kismi filtre (Mongo ayni anahtarli iki indeksi filtreleri
        // farkliysa ayri tutar): gecmis indeksi (#101) tam indeksle ayni anahtarli, kismi.
        for (const name of [COLLECTIONS.ORDERS, COLLECTIONS.OUTBOX]) {
          const indexes = await db.collection(name).indexes();
          const keys = indexes.map((index) =>
            JSON.stringify({ key: index.key, partial: index.partialFilterExpression ?? null }),
          );
          expect(new Set(keys).size, name).toBe(keys.length);
          const names = indexes.map((index) => index.name);
          expect(new Set(names).size, name).toBe(names.length);
        }
        const orderIndexes = await db.collection(COLLECTIONS.ORDERS).indexes();
        expect(orderIndexes.find((index) => index.name === HISTORY_INDEX_NAME)).toMatchObject({
          key: { userId: 1, createdAt: -1, _id: -1 },
          partialFilterExpression: { inHistory: true },
        });
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'P5 migrate: status, up (iki kez), down, up 0; kayit sayilari; bilinmeyen komut 2, adres yok 1',
    async () => {
      expect(MIGRATIONS.length).toBeGreaterThan(0);
      const env = serviceEnv();
      const applied = () =>
        withDatabase(env, (db) => db.collection(MIGRATIONS_COLLECTION).countDocuments());
      const steps: readonly [string, number][] = [
        ['status', 0],
        ['up', MIGRATIONS.length],
        ['up', MIGRATIONS.length],
        ['down', MIGRATIONS.length - 1],
        ['up', MIGRATIONS.length],
      ];
      for (const [command, expected] of steps) {
        const run = await runEntry(MIGRATE, [command], env);
        expect({ command, code: run.code, applied: await applied() }).toEqual({
          command,
          code: 0,
          applied: expected,
        });
      }
      expect((await runEntry(MIGRATE, ['yana'], env)).code).toBe(2);
      expect((await runEntry(MIGRATE, [], env)).code).toBe(2);
      const missing = await runEntry(MIGRATE, ['status'], serviceEnv({}, ['ORDER_MONGO_URI']));
      expect(missing.code).toBe(1);
      expect(missing.output).toContain('ORDER_MONGO_URI');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'P6 SIGTERM supurucu turu payment ta beklerken: tur biter ve siparisi kapatir, zarif, ERROR yok',
    async () => {
      const payments = new InMemoryPaymentStore();
      const faults = new PaymentFaults();
      const paymentAddress = await startPayment({ payments, faults, clock: world.clock, closers });
      const env = serviceEnv({
        PAYMENT_GRPC_ADDR: paymentAddress,
        ORDER_SWEEPER_INTERVAL_MS: SWEEPER_INTERVAL_MS,
      });
      // Kilidi bir saat once dolmus, odeme bekleyen siparis (surecin saati gercek saat).
      const store = await openOrderStore(
        {
          uri: env['ORDER_MONGO_URI'] ?? '',
          dbName: env['ORDER_MONGO_DB'] ?? '',
          serverSelectionTimeoutMs: 5_000,
          operationTimeoutMs: 5_000,
        },
        silentLogger,
        'development',
      );
      closers.push(() => store.close());
      const lapsed = await insertAwaitingPayment(
        store.repository,
        fixedClock(Date.now() - 2 * 60 * 60 * 1_000),
      );
      const held = faults.holdBefore('getPayment', lapsed.id);

      const running = await start(env);
      expect(running.ready).toBe(true);
      await held.arrived;
      const closed = new Promise<number | null>((resolve) => running.child.once('close', resolve));
      running.child.kill('SIGTERM');
      // Sunucu bosaltildi (port reddediyor): kapanis kancasi basladi, supurucunun turunu bekliyor.
      // Tur payment'ta; cevap ancak simdi verilir. (payment cagrisinin siniri uretimde sabit 3 sn;
      // bu adim portu yoklayan bekleme kadar surer.)
      expect(await waitUntil(() => refuses(running.port), SEEN_WITHIN_MS)).toBe(true);
      expect(logLines(running.output(), 'zarif kapanis bitti')).toHaveLength(0);
      held.gate.open();

      expect(await closed).toBe(0);
      const output = running.output();
      for (const worker of WORKERS) expect(logLines(output, worker), worker).toHaveLength(1);
      expect(logLines(output, 'zarif kapanis bitti')[0]).toMatchObject({
        forced: false,
        hook: 'done',
      });
      expect(output).not.toContain('"level":"error"');
      expect(faults.calls('getPayment', lapsed.id)).toBe(1);
      // Turun yazimi kapanistan once bitti: siparis kapali, iptalin olaylari outbox'ta (kurulumun
      // AWAITING_PAYMENT olayi sayilmaz).
      const closedOrder = await store.repository.findById(lapsed.id);
      expect(closedOrder?.status).toBe(ORDER_STATUS.CANCELLED);
      const events = await withDatabase(env, (db) =>
        db
          .collection<OutboxDocument>(COLLECTIONS.OUTBOX)
          .find({ aggregateId: lapsed.id })
          .toArray(),
      );
      const cancelled = events.filter(
        (event) =>
          event.topic === EVENTS.ORDER_STATUS_CHANGED &&
          event.payload['to'] === ORDER_STATUS.CANCELLED,
      );
      expect(cancelled).toHaveLength(1);
      const commands = events.filter((event) => event.topic === EVENTS.PAYMENT_CANCEL_REQUESTED);
      expect(commands).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );
});
