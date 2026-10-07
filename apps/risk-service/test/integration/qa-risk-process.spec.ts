/**
 * QA kara kutu (T15.2, risk geriye donuk PR 3; RQ3b): risk'in GERCEK sureci (dist/main.js,
 * dist/migrate.js, dist/healthcheck.js) gercek Mongo'yla (Testcontainers); payment PQ6 ve order
 * OQ7 deseni. Surec baslatici inventory'nin QA yardimcisindan (ortaklasma bekleyen is #106).
 *
 *   P1 MOCK=true: Mongo olmadan acilir, telden karar verir ve okur; healthcheck 0, kapali portta 1.
 *   P2 ortam hatasi (Mongo adresi yok, port bicimsiz, islem siniri sinir disi): acilmaz, cikis 1.
 *   P3 Mongo ulasilamaz: askida kalmaz, butce icinde fatal satirla sifir olmayan kodla cikar.
 *   P4 iki kopya ayni anda bos veritabanina: ikisi de hazir, risk_events indeksleri tek.
 *   P5 migrate: status, up (iki kez), down 0; bilinmeyen komut 2, adres yok 1. Kodda olmayan
 *      uygulanmis goc (kod geri alinmis): migrate status 1, servis acilmaz.
 *   P6 SIGTERM, degerlendirmenin kaydi Mongo'nun kapisinda beklerken: sunucu yeni baglanti almaz,
 *      cagri cevaplanir, KAYIT YAZILIR (baglanti cagri bitmeden kapanmaz), kanca bitti, zorlanmadi.
 *   P7 LOG_LEVEL=debug gunlugu kisisel veri tasimaz: IP, cihaz, sehir ve koordinat yok (gecerli,
 *      gecersiz ve bulunamayan cagrilar).
 *
 * CI'da `pnpm build` entegrasyon testlerinden once kosar; yerelde once derleyin.
 */

import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';

import { GRPC_STATUS } from '@getir/core';
import { connectMongo, MIGRATIONS_COLLECTION } from '@getir/mongo-kit';
import type { MigrationRecord } from '@getir/mongo-kit';
import { riskV1 } from '@getir/proto';
import { unaryCall } from '@getir/service-kit/testing';
import { Client, credentials } from '@grpc/grpc-js';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  logLines,
  runEntry,
  startProcess,
  stopAllProcesses,
  waitUntil,
} from '../../../inventory-service/test/support/qa-inventory-process.js';
import type { RunningProcess } from '../../../inventory-service/test/support/qa-inventory-process.js';
import { startFreezingProxy } from '../../../../packages/mongo-kit/test/support/freezing-proxy.js';
import type { RiskContext } from '../../src/domain/risk-context.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import { MIGRATIONS } from '../../src/migrations/index.js';
import { toProtoContext } from '../support/proto-context.js';

const dist = (file: string) => fileURLToPath(new URL(`../../dist/${file}`, import.meta.url));
const MAIN = dist('main.js');
const MIGRATE = dist('migrate.js');
const HEALTHCHECK = dist('healthcheck.js');
const READY = 'risk servisi hazir';
const PORT_ENV = 'RISK_GRPC_PORT';
const CONTAINER_START_TIMEOUT_MS = 120_000;
const TEST_TIMEOUT_MS = 60_000;
/** Ulasilamayan bagimlida bekleme siniri: surec bu sureyi asarsa askida demektir. */
const UNREACHABLE_BUDGET_MS = 15_000;
/** Yoklama butcesi: gunluk satiri ya da bekletilen yazim bu surede gorunmeli. */
const SEEN_WITHIN_MS = 15_000;
/**
 * P6'da kaydin islem siniri ve bosaltma suresi testin bekleme butcelerinden uzun: vekil cozulene
 * kadar yazim zaman asimina (varsayilan 2 sn, #167), bosaltma zorlamaya (varsayilan 10 sn)
 * dusmesin; test kapanis SIRASINI sinar, sureyi degil.
 */
const PATIENT_OPERATION_TIMEOUT_MS = '45000';
const PATIENT_SHUTDOWN_TIMEOUT_MS = '45000';
/** Dinleyeni olmayan port: baglanti hemen reddedilir (ortam semasinin araliginda). */
const UNREACHABLE_PORT = 1;
/** risk_events'e yazim komutu (OP_MSG govdesinde BSON anahtar ve koleksiyon adi). */
const INSERT_COMMAND = [Buffer.from('insert\0'), Buffer.from(COLLECTIONS.RISK_EVENTS)];
const DAY_MS = 24 * 60 * 60 * 1_000;
const IP = '203.0.113.58';
const PREVIOUS_IP = '198.51.100.61';
const IP_CITY = 'Uskudar-QA';
const DEVICE = 'dev_qa_surec_cihazi';
const DELIVERY = { lat: 41.0231, lng: 29.0152 };
const SESSION = { lat: 41.0532, lng: 29.0093 };

let mongo: StartedMongoDBContainer | undefined;
let databases = 0;
const closers: (() => Promise<unknown> | void)[] = [];

beforeAll(async () => {
  for (const entry of [MAIN, MIGRATE, HEALTHCHECK]) {
    if (!existsSync(entry)) throw new Error(`${entry} yok: once "pnpm build"`);
  }
  mongo = await new MongoDBContainer('mongo:7').start();
}, CONTAINER_START_TIMEOUT_MS);

/** Her kapanis denenir (biri dusse de digerleri); hatalar sonda birlikte raporlanir. */
afterEach(async () => {
  await stopAllProcesses();
  const failures: unknown[] = [];
  for (const close of closers.splice(0).reverse()) {
    try {
      await close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'test kapanisi dustu');
});

afterAll(async () => {
  await mongo?.stop();
});

const directUri = (port?: number): string => {
  if (mongo === undefined) throw new Error('Mongo yok');
  return port === undefined
    ? `${mongo.getConnectionString()}?directConnection=true`
    : `mongodb://127.0.0.1:${String(port)}/?directConnection=true`;
};

/** Uretim ortami (MOCK kapali), taze veritabaniyla; `omit` degiskeni hic vermez. */
function serviceEnv(
  overrides: Record<string, string> = {},
  omit: readonly string[] = [],
): Record<string, string> {
  databases += 1;
  const env: Record<string, string> = {
    NODE_ENV: 'development',
    LOG_LEVEL: 'info',
    MOCK: 'false',
    RISK_MONGO_URI: directUri(),
    RISK_MONGO_DB: `qa_risk_surec_${String(databases)}`,
    ...overrides,
  };
  return Object.fromEntries(Object.entries(env).filter(([name]) => !omit.includes(name)));
}

const start = (env: Record<string, string>): Promise<RunningProcess> =>
  startProcess({ entry: MAIN, readyMessage: READY, portEnv: PORT_ENV, env });

async function withDatabase<T>(
  env: Record<string, string>,
  use: (db: Awaited<ReturnType<typeof connectMongo>>['db']) => Promise<T>,
): Promise<T> {
  const connection = await connectMongo({
    uri: directUri(),
    dbName: env['RISK_MONGO_DB'] ?? '',
    appName: 'qa-risk-surec',
  });
  try {
    return await use(connection.db);
  } finally {
    await connection.close();
  }
}

/** Surecin gRPC'sine istemci (test sonunda kapanir). */
function clientOf(running: RunningProcess): Client {
  const client = new Client(`127.0.0.1:${String(running.port)}`, credentials.createInsecure());
  closers.push(() => client.close());
  return client;
}

const evaluateOn = (client: Client, context: RiskContext) =>
  unaryCall(client, riskV1.RiskServiceService.evaluate, { context: toProtoContext(context) });

function personalContext(n: number): RiskContext {
  const serial = String(n).padStart(4, '0');
  return {
    userId: `usr_${'6'.repeat(28)}${serial}`,
    orderId: `ord_${'6'.repeat(28)}${serial}`,
    marketId: 'mkt_migros-jet-moda',
    accountCreatedAt: new Date(Date.now() - 30 * DAY_MS),
    deliveredOrderCount: 3,
    cancelledOrderCount: 0,
    basketTotalMinor: 7_990,
    userAverageBasketMinor: 8_000,
    checkoutDwellMs: 10_000,
    deliveryLocation: DELIVERY,
    sessionLocation: SESSION,
    ipAddress: IP,
    previousIpAddress: PREVIOUS_IP,
    ipCity: IP_CITY,
    deviceId: DEVICE,
    accountsOnDevice: 1,
  };
}

/**
 * Port baglantiyi REDDEDIYOR mu (sunucu yeni cagri almiyor). order OQ7'deki kopyanin dinleyici
 * temizleyen hali; ortak yardimciya tasinmasi #106.
 */
function refuses(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const settle = (refused: boolean): void => {
      socket.off('connect', onConnect);
      socket.off('error', onError);
      socket.destroy();
      resolve(refused);
    };
    const onConnect = (): void => settle(false);
    const onError = (): void => settle(true);
    socket.once('connect', onConnect);
    socket.once('error', onError);
  });
}

const closedWith = (running: RunningProcess) =>
  new Promise<number | null>((resolve) => running.child.once('close', resolve));

describe('QA RQ3b risk sureci: acilis, ortam, gocler, kapanis ve gunluk', () => {
  it(
    'P1 MOCK=true: Mongo olmadan acilir, telden karar verir ve okur; healthcheck 0, kapali portta 1',
    async () => {
      const running = await start(serviceEnv({ MOCK: 'true' }, ['RISK_MONGO_URI']));

      expect(running.ready).toBe(true);
      expect(logLines(running.output(), READY)[0]).toMatchObject({
        mock: true,
        storage: 'bellek (MOCK)',
      });
      const client = clientOf(running);
      const context = personalContext(1);
      const evaluated = await evaluateOn(client, context);
      const read = await unaryCall(client, riskV1.RiskServiceService.getLastEvaluation, {
        userId: context.userId,
        orderId: context.orderId ?? '',
      });
      expect(evaluated.error).toBeUndefined();
      expect(read.response?.evaluation).toEqual(evaluated.response?.evaluation);

      const probe = (port: number) => runEntry(HEALTHCHECK, [], { [PORT_ENV]: String(port) });
      expect((await probe(running.port)).code).toBe(0);
      // Dinleyeni olmayan gecerli port: 1, yoklamanin kendisi duser (ortam hatasi degil).
      const unhealthy = await probe(UNREACHABLE_PORT);
      expect([unhealthy.code, unhealthy.output.includes(PORT_ENV)]).toEqual([1, false]);
    },
    TEST_TIMEOUT_MS,
  );

  it.each([
    ['Mongo adresi yok', {}, ['RISK_MONGO_URI'], 'RISK_MONGO_URI'],
    ['port bicimsiz', { [PORT_ENV]: 'abc' }, [], PORT_ENV],
    [
      'islem siniri ust sinirin ustunde',
      { MONGO_OPERATION_TIMEOUT_MS: '60001' },
      [],
      'MONGO_OPERATION_TIMEOUT_MS',
    ],
  ] as const)(
    'P2 ortam hatasi (%s): acilmaz, cikis 1, sebep gunlukte',
    async (_label, overrides, omit, key) => {
      const running = await start(serviceEnv({ ...overrides }, omit));

      expect([running.ready, running.exitCode]).toEqual([false, 1]);
      expect(running.output()).toContain(key);
    },
    TEST_TIMEOUT_MS,
  );

  it.each([
    ['baglanti reddedilir', false],
    ['baglanti kabul edilir ama cevap gelmez (donuk vekil)', true],
  ] as const)(
    'P3 Mongo ulasilamaz (%s): askida kalmaz, butce icinde fatal satirla sifir olmayan kodla cikar',
    async (_label, silent) => {
      let port = UNREACHABLE_PORT;
      if (silent) {
        if (mongo === undefined) throw new Error('Mongo yok');
        const proxy = await startFreezingProxy({
          host: mongo.getHost(),
          port: mongo.getMappedPort(27017),
        });
        closers.push(() => proxy.close());
        proxy.freeze();
        port = proxy.port;
      }
      const running = await start(
        serviceEnv({
          RISK_MONGO_URI: directUri(port),
          MONGO_SERVER_SELECTION_TIMEOUT_MS: '1000',
        }),
      );

      expect(running.ready).toBe(false);
      expect(running.exitCode).not.toBe(0);
      expect(running.exitCode).not.toBeNull();
      expect(running.elapsedMs).toBeLessThan(UNREACHABLE_BUDGET_MS);
      expect(logLines(running.output(), 'servis acilamadi')).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'P4 iki kopya ayni anda bos veritabanina: ikisi de hazir, risk_events indeksleri tek',
    async () => {
      expect(MIGRATIONS).toHaveLength(0);
      const env = serviceEnv();
      const [first, second] = await Promise.all([start(env), start(env)]);

      expect([first.ready, second.ready]).toEqual([true, true]);
      for (const running of [first, second]) {
        expect(logLines(running.output(), READY)[0]).toMatchObject({ storage: 'mongo' });
      }
      await withDatabase(env, async (db) => {
        const indexes = await db.collection(COLLECTIONS.RISK_EVENTS).indexes();
        expect(indexes.map((index) => index.name).sort()).toEqual([
          '_id_',
          'orderId_createdAt',
          'userId_createdAt',
        ]);
        expect(await db.collection(MIGRATIONS_COLLECTION).countDocuments()).toBe(0);
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'P5 migrate: status, up, down 0; kullanim 2, adres yok 1; kodda olmayan goc: status 1, servis acilmaz',
    async () => {
      // Risk'in bugun gocu YOK: komut sozlesmesi (cikis kodlari) ve tutarlilik kapisi sinanir.
      const env = serviceEnv();
      for (const command of ['status', 'up', 'up', 'down', 'status']) {
        const run = await runEntry(MIGRATE, [command], env);
        expect({ command, code: run.code }).toEqual({ command, code: 0 });
      }
      expect((await runEntry(MIGRATE, ['yana'], env)).code).toBe(2);
      expect((await runEntry(MIGRATE, [], env)).code).toBe(2);
      const missing = await runEntry(MIGRATE, ['status'], serviceEnv({}, ['RISK_MONGO_URI']));
      expect([missing.code, missing.output.includes('RISK_MONGO_URI')]).toEqual([1, true]);

      // Kod geri alindi: veritabaninda uygulanmis ama kodda olmayan goc.
      await withDatabase(env, (db) =>
        db.collection<MigrationRecord>(MIGRATIONS_COLLECTION).insertOne({
          _id: 1,
          name: '0001-qa-geri-alinmis-goc',
          appliedAt: new Date(),
          durationMs: 0,
        }),
      );
      expect((await runEntry(MIGRATE, ['status'], env)).code).toBe(1);
      const refused = await start(env);
      expect([refused.ready, refused.exitCode]).toEqual([false, 1]);
      expect(logLines(refused.output(), 'servis acilamadi')).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'P6 SIGTERM, kayit Mongo kapisinda beklerken: yeni baglanti yok, cagri cevaplanir, kayit yazilir, zarif',
    async () => {
      if (mongo === undefined) throw new Error('Mongo yok');
      // Donukken bekletilen baytlar birikir: parcalara bolunen komut da taninir.
      let held = Buffer.alloc(0);
      const proxy = await startFreezingProxy(
        { host: mongo.getHost(), port: mongo.getMappedPort(27017) },
        {
          onHeld: (chunk) => {
            held = Buffer.concat([held, chunk]);
          },
        },
      );
      closers.push(() => proxy.close());
      const insertHeld = () => INSERT_COMMAND.every((part) => held.includes(part));
      const env = serviceEnv({
        LOG_LEVEL: 'debug',
        RISK_MONGO_URI: directUri(proxy.port),
        MONGO_OPERATION_TIMEOUT_MS: PATIENT_OPERATION_TIMEOUT_MS,
        GRPC_SHUTDOWN_TIMEOUT_MS: PATIENT_SHUTDOWN_TIMEOUT_MS,
      });
      const running = await start(env);
      expect(running.ready).toBe(true);
      const context = personalContext(6);
      const closed = closedWith(running);

      proxy.freeze();
      const answer = evaluateOn(clientOf(running), context);
      try {
        expect(await waitUntil(insertHeld, SEEN_WITHIN_MS)).toBe(true);
        running.child.kill('SIGTERM');
        const draining = () => logLines(running.output(), 'zarif kapanis basladi').length === 1;
        expect(await waitUntil(draining, SEEN_WITHIN_MS)).toBe(true);
        expect(await waitUntil(() => refuses(running.port), SEEN_WITHIN_MS)).toBe(true);
      } finally {
        proxy.thaw();
      }

      const { error, response } = await answer;
      expect([error?.code, response?.evaluation === undefined]).toEqual([undefined, false]);
      expect(await closed).toBe(0);
      const output = running.output();
      expect(logLines(output, 'zarif kapanis bitti')[0]).toMatchObject({
        forced: false,
        hook: 'done',
      });
      expect(output).not.toContain('"level":"error"');
      // Sira: cagri tamamlandi, SONRA Mongo baglantisi kapandi (kayit sayisi tek basina kanit
      // degil: vekil, kapanmis baglantinin bekletilen yazimini da cozulunce Mongo'ya iletir).
      const completedAt = output.indexOf('"msg":"rpc tamamlandi"');
      const disconnectedAt = output.indexOf('"msg":"mongo baglantisi kapandi"');
      expect([completedAt > -1, disconnectedAt > completedAt]).toEqual([true, true]);
      const recorded = await withDatabase(env, (db) =>
        db.collection(COLLECTIONS.RISK_EVENTS).countDocuments({ orderId: context.orderId }),
      );
      expect(recorded).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'P7 LOG_LEVEL=debug gunlugu kisisel veri tasimaz (gecerli, gecersiz, bulunamayan cagri)',
    async () => {
      const running = await start(
        serviceEnv({ MOCK: 'true', LOG_LEVEL: 'debug' }, ['RISK_MONGO_URI']),
      );
      expect(running.ready).toBe(true);
      const client = clientOf(running);
      const context = personalContext(7);

      expect((await evaluateOn(client, context)).error).toBeUndefined();
      const invalid = await evaluateOn(client, {
        ...context,
        sessionLocation: { lat: 91, lng: SESSION.lng },
      });
      expect(invalid.error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
      const missing = await unaryCall(client, riskV1.RiskServiceService.getLastEvaluation, {
        userId: context.userId,
        orderId: `ord_${'9'.repeat(32)}`,
      });
      expect(missing.error?.code).toBe(GRPC_STATUS.NOT_FOUND);

      // Gunluk tam yazilsin: surec kapanir, sonra okunur.
      const closed = closedWith(running);
      running.child.kill('SIGTERM');
      expect(await closed).toBe(0);
      const output = running.output();
      expect(logLines(output, 'rpc tamamlandi').length).toBeGreaterThan(0);
      expect(logLines(output, 'rpc is hatasiyla dondu')).toHaveLength(2);
      for (const secret of [IP, PREVIOUS_IP, IP_CITY, DEVICE]) {
        expect(output, secret).not.toContain(secret);
      }
      // Koordinat tek basina sayi olarak (tam ve yuvarlanmis); durationMs gibi sayilarin icindeki
      // rastlantisal rakam dizileri sayilmaz.
      for (const value of [DELIVERY.lat, DELIVERY.lng, SESSION.lat, SESSION.lng]) {
        for (const text of [String(value), value.toFixed(2)]) {
          const standalone = new RegExp(`(?<![\\d.])${text.replace('.', '\\.')}(?!\\d)`);
          expect(output, text).not.toMatch(standalone);
        }
      }
    },
    TEST_TIMEOUT_MS,
  );
});
