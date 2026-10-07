/**
 * QA kara kutu (T15.2, risk geriye donuk PR 2; RQ2): risk_events kaydi ve son degerlendirme. Iki risk
 * kopyasi tek Mongo'da (uretimin openRiskEventStore'u: gocler, indeksler), gercek gRPC. Mongo
 * ortami uretimin varsayilanlariyla (risk'in ortam semasi: islem siniri 2 sn).
 *
 *   R1 iki kopyaya es zamanli degerlendirmeler: her degerlendirme TEK kayit (siparis basina bir),
 *      ikinci degerlendirme (yeniden deneme) ikinci kayit; son degerlendirme iki kopyadan da ayni.
 *      Ham Mongo belgesi IP, cihaz, sehir ve koordinat tasimaz (gerekceler dolu).
 *   R2 GetLastEvaluation sahipligi: baskasinin siparisi NOT_FOUND, olmayan siparisle AYNI cevap
 *      (varlik ve sahibin kimligi sizmaz); sahip ayni siparisi okur; yalniz kullaniciyla sorgu
 *      onun en son degerlendirmesi.
 *   R3 BULGU (#167): kayit yazilamazsa karar yine doner (tasarim, T6.3) ama kayit BEKLENIR. Mongo
 *      donarsa (dondurulabilen vekil) order'in GERCEK risk istemcisi kendi butcesiyle (1 sn) karari
 *      alamaz: DEADLINE_EXCEEDED -> SERVICE_UNAVAILABLE. Genis sureli cagiran karari alir, ama
 *      order'in butcesinden gec. Duzeltme PR'i (kayda ayri kisa sinir) bu beklentiyi cevirir.
 */

import { AppError, fixedClock, silentLogger } from '@getir/core';
import type { MutableClock } from '@getir/core';
import { connectMongo, mongoEnvSchemaFor } from '@getir/mongo-kit';
import type { MongoEnv } from '@getir/mongo-kit';
import { riskV1 } from '@getir/proto';
import { appErrorPayloadOf, startTestGrpcServer } from '@getir/service-kit/testing';
import type { TestGrpcServer } from '@getir/service-kit/testing';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { status } from '@grpc/grpc-js';
import type { ServiceError } from '@grpc/grpc-js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { RISK_CALL_TIMEOUT_MS } from '../../../order-service/src/config/constants.js';
import {
  DEPENDENCY,
  dependencyResilience,
} from '../../../order-service/src/infrastructure/grpc-resilience.js';
import { GrpcRiskAssessment } from '../../../order-service/src/infrastructure/risk/grpc-risk-assessment.js';
import { startFreezingProxy } from '../../../../packages/mongo-kit/test/support/freezing-proxy.js';
import type { FreezingProxy } from '../../../../packages/mongo-kit/test/support/freezing-proxy.js';
import { buildRiskService } from '../../src/bootstrap.js';
import { DEFAULT_MONGO_DB } from '../../src/config/constants.js';
import type { RiskContext } from '../../src/domain/risk-context.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import { RiskEventsCollection } from '../../src/infrastructure/mongo/risk-events-collection.js';
import { openRiskEventStore } from '../../src/infrastructure/risk-event-store.js';
import { evaluate, fired } from '../support/qa-risk-calls.js';

const CONTAINER_START_TIMEOUT_MS = 120_000;
const T0 = Date.parse('2026-10-07T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1_000;
const EVALUATIONS = 12;
/** Kisisel sinyaller: geofence (oturum ~56 km uzakta) ve ip-device (IP degisti) tetiklenir. */
const DELIVERY = { lat: 40.9912, lng: 29.0271 };
const SESSION = { lat: 41.4943, lng: 29.0271 };
const IP = '203.0.113.41';
const PREVIOUS_IP = '198.51.100.73';
const IP_CITY = 'Kadikoy-QA';
const DEVICE = 'dev_qa_risk_kayit_cihazi';

let mongo: StartedMongoDBContainer | undefined;
let databases = 0;
const closers: (() => Promise<unknown>)[] = [];

beforeAll(async () => {
  mongo = await new MongoDBContainer('mongo:7').start();
}, CONTAINER_START_TIMEOUT_MS);

/** Her kapanis denenir (biri dusse de digerleri); hatalar sonda birlikte raporlanir. */
afterEach(async () => {
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

/** Uretimin Mongo ortami (risk'in semasi, varsayilan sinirlar); `port` verilirse oraya baglanir. */
function productionMongoEnv(dbName: string, port?: number): MongoEnv {
  if (mongo === undefined) throw new Error('Mongo yok');
  const uri =
    port === undefined
      ? `${mongo.getConnectionString()}?directConnection=true`
      : `mongodb://127.0.0.1:${String(port)}/?directConnection=true`;
  const parsed = mongoEnvSchemaFor({ prefix: 'RISK', defaultDb: DEFAULT_MONGO_DB }).safeParse({
    RISK_MONGO_URI: uri,
    RISK_MONGO_DB: dbName,
  });
  if (!parsed.success) throw new Error(`Mongo ortami gecersiz: ${parsed.error.message}`);
  return parsed.data;
}

/** Bir risk kopyasi: kendi baglantisiyla uretimin deposu, gercek gRPC. */
async function startRiskCopy(env: MongoEnv, clock: MutableClock): Promise<TestGrpcServer> {
  const store = await openRiskEventStore(env, silentLogger);
  closers.push(() => store.close());
  const server = await startTestGrpcServer({
    serviceName: 'qa-risk-kopya',
    logger: silentLogger,
    services: [buildRiskService({ events: store.repository, clock, logger: silentLogger })],
  });
  closers.push(() => server.stop());
  return server;
}

/** risk_events'i dogrudan okuyan tek baglanti (deponun sorgu yuzeyinde sayim ve ham belge yok). */
async function openEventsReader(env: MongoEnv) {
  const connection = await connectMongo({ ...env, appName: 'qa-risk-okuyucu' });
  closers.push(() => connection.close());
  return {
    events: new RiskEventsCollection(connection.db),
    raw: connection.db.collection(COLLECTIONS.RISK_EVENTS),
  };
}

function context(userId: string, orderId: string): RiskContext {
  return {
    userId,
    orderId,
    marketId: 'mkt_migros-jet-moda',
    accountCreatedAt: new Date(T0 - 30 * DAY_MS),
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

const userOf = (n: number) => `usr_${'5'.repeat(28)}${String(n).padStart(4, '0')}`;
const orderOf = (n: number) => `ord_${'5'.repeat(28)}${String(n).padStart(4, '0')}`;

/** Hatanin istemciye gorunen her seyi, verilen kimlikler maskeli (istek kimligi haric). */
function visible(error: ServiceError | undefined, ...ids: string[]): string {
  const { requestId: _requestId, ...payload } = appErrorPayloadOf(error) ?? {};
  let text = JSON.stringify({ grpc: error?.code, text: error?.details, payload });
  for (const id of ids) text = text.replaceAll(id, '<id>');
  return text;
}

describe('QA RQ2 risk_events kaydi ve son degerlendirme (iki kopya, gercek Mongo)', () => {
  it('R1 es zamanli degerlendirmeler: her biri tek kayit; tekrar ikinci kayit; son degerlendirme iki kopyada ayni', async () => {
    databases += 1;
    const env = productionMongoEnv(`qa_risk_kayit_${String(databases)}`);
    const clock = fixedClock(T0);
    const first = await startRiskCopy(env, clock);
    const second = await startRiskCopy(env, clock);
    const reader = await openEventsReader(env);
    const userId = userOf(1);

    const evaluations = await Promise.all(
      Array.from({ length: EVALUATIONS }, (_, n) =>
        evaluate(n % 2 === 0 ? first : second, context(userId, orderOf(n))),
      ),
    );
    expect(fired(evaluations[0] ?? { hits: [] })).toEqual(['geofence', 'ip-device']);
    // Ayni siparis yeniden degerlendirilir (order tekrar denerse): ikinci kayit, daha yeni an.
    clock.advance(1_000);
    const retried = await evaluate(second, context(userId, orderOf(0)));

    const perOrder = await Promise.all(
      Array.from({ length: EVALUATIONS }, (_, n) =>
        reader.events.count({ userId, orderId: orderOf(n) }),
      ),
    );
    expect(perOrder).toEqual(Array.from({ length: EVALUATIONS }, (_, n) => (n === 0 ? 2 : 1)));
    for (const copy of [first, second]) {
      const { response } = await copy.call(riskV1.RiskServiceService.getLastEvaluation, {
        userId,
        orderId: orderOf(0),
      });
      expect(response?.evaluation?.evaluatedAt).toEqual(retried.evaluatedAt);
    }
    expect(await reader.events.count({ userId })).toBe(EVALUATIONS + 1);

    // Ham belge: gerekceler dolu, kisisel sinyal yok (yuvarlanmis koordinat dahil).
    const documents = await reader.raw.find({ userId }).toArray();
    expect(documents).toHaveLength(EVALUATIONS + 1);
    const reasons = documents.flatMap((document) =>
      (document['rules'] as { hit: boolean; reason: string }[]).filter((rule) => rule.hit),
    );
    expect(reasons.length).toBe(2 * (EVALUATIONS + 1));
    expect(reasons.every((rule) => rule.reason.trim() !== '')).toBe(true);
    const text = JSON.stringify(documents);
    const coordinates = [DELIVERY.lat, DELIVERY.lng, SESSION.lat, SESSION.lng].flatMap((value) => [
      String(value),
      value.toFixed(2),
    ]);
    for (const secret of [IP, PREVIOUS_IP, IP_CITY, DEVICE, ...coordinates]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it('R2 sahiplik: baskasinin siparisi olmayanla ayni NOT_FOUND; sahip okur; kullanici sorgusu en son degerlendirme', async () => {
    databases += 1;
    const env = productionMongoEnv(`qa_risk_sahiplik_${String(databases)}`);
    const clock = fixedClock(T0);
    const risk = await startRiskCopy(env, clock);
    const owner = userOf(2);
    const stranger = userOf(3);
    const earlier = await evaluate(risk, context(owner, orderOf(100)));
    clock.advance(1_000);
    const latest = await evaluate(risk, context(owner, orderOf(101)));

    const foreign = await risk.call(riskV1.RiskServiceService.getLastEvaluation, {
      userId: stranger,
      orderId: orderOf(100),
    });
    const missing = await risk.call(riskV1.RiskServiceService.getLastEvaluation, {
      userId: stranger,
      orderId: orderOf(999),
    });
    expect(foreign.response).toBeUndefined();
    expect([foreign.error?.code, appErrorPayloadOf(foreign.error)?.code]).toEqual([
      status.NOT_FOUND,
      'NOT_FOUND',
    ]);
    expect(visible(foreign.error, orderOf(100))).toBe(visible(missing.error, orderOf(999)));
    expect(JSON.stringify(foreign.error?.metadata.getMap() ?? {})).not.toContain(owner);

    // Kontrol: ayni siparisi sahibi okur (NOT_FOUND kaydin yoklugundan degil).
    const mine = await risk.call(riskV1.RiskServiceService.getLastEvaluation, {
      userId: owner,
      orderId: orderOf(100),
    });
    expect(mine.response?.evaluation?.evaluatedAt).toEqual(earlier.evaluatedAt);

    const own = await risk.call(riskV1.RiskServiceService.getLastEvaluation, {
      userId: owner,
      orderId: '',
    });
    expect(own.response?.evaluation?.evaluatedAt).toEqual(latest.evaluatedAt);
  });

  it('R3 BULGU #167: Mongo donunca order in risk istemcisi kendi butcesinde karar alamaz; genis sure karari gec alir', async () => {
    if (mongo === undefined) throw new Error('Mongo yok');
    databases += 1;
    const proxy: FreezingProxy = await startFreezingProxy({
      host: mongo.getHost(),
      port: mongo.getMappedPort(27017),
    });
    closers.push(() => proxy.close());
    const env = productionMongoEnv(`qa_risk_donma_${String(databases)}`, proxy.port);
    const risk = await startRiskCopy(env, fixedClock(T0));
    const clientWith = (timeoutMs: number) => {
      const client = new GrpcRiskAssessment(
        `127.0.0.1:${String(risk.handle.port)}`,
        timeoutMs,
        dependencyResilience(DEPENDENCY.RISK, silentLogger),
      );
      closers.push(() => Promise.resolve(client.close()));
      return client;
    };
    const order = clientWith(RISK_CALL_TIMEOUT_MS);
    const patient = clientWith(env.operationTimeoutMs + 3_000);
    const request = {
      userId: userOf(4),
      orderId: orderOf(200),
      marketId: 'mkt_migros-jet-moda',
      deliveredOrderCount: 3,
      cancelledOrderCount: 0,
      basketTotalMinor: 7_990,
      currency: 'TRY',
      checkoutDwellMs: 10_000,
      deliveryLocation: DELIVERY,
      signals: {},
    };
    const scope = { requestId: 'req_qa_risk_donma', logger: silentLogger };

    // Kontrol: Mongo akarken karar order'in butcesinde gelir.
    await expect(order.evaluate(request, scope)).resolves.toMatchObject({ band: 'LOW' });
    expect(env.operationTimeoutMs).toBeGreaterThan(RISK_CALL_TIMEOUT_MS);

    // Mongo donar: kural motoru karari bulur, ama cevap kaydin yazilmasini bekler.
    proxy.freeze();
    try {
      const failure: unknown = await order
        .evaluate({ ...request, orderId: orderOf(201) }, scope)
        .then(
          () => 'karar geldi',
          (error: unknown) => error,
        );
      expect(failure).toBeInstanceOf(AppError);
      const { code, cause } = failure as AppError & { cause?: ServiceError };
      expect([code, cause?.code]).toEqual(['SERVICE_UNAVAILABLE', status.DEADLINE_EXCEEDED]);

      // Kaydi bekleyebilen cagiran karari alir: kayit Mongo'nun islem sinirinda duser, karar doner.
      const startedAt = performance.now();
      await expect(
        patient.evaluate({ ...request, orderId: orderOf(202) }, scope),
      ).resolves.toMatchObject({ band: 'LOW' });
      expect(performance.now() - startedAt).toBeGreaterThanOrEqual(RISK_CALL_TIMEOUT_MS);
    } finally {
      proxy.thaw();
    }
  });
});
