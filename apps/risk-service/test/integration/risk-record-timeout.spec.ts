/**
 * #167 gercek Mongo ile: Mongo donunca (dondurulabilen vekil) order'in GERCEK
 * risk istemcisi kendi butcesinde (RISK_CALL_TIMEOUT_MS) karari ALIR; kayit sure
 * siniri asilir (en az sinir kadar surer, timeouts metrigi) ve beklenmez. Mongo
 * cozulunce donukken baslayan kayitlar arka planda yazilir (late). Uretimin
 * deposu (openRiskEventStore: gocler, indeksler); islem siniri bu testte genis
 * (dondurma suresi yuk altinda uzasa da arka plandaki kayit dusmesin).
 * Okumalar sinirli bekleme + sabit aralikla (Evaluate kaydi beklemeyebilir).
 */

import { silentLogger } from '@getir/core';
import { metricsRegistry } from '@getir/observability';
import { metricValue } from '@getir/observability/testing';
import { connectMongo, mongoEnvSchemaFor } from '@getir/mongo-kit';
import type { MongoEnv } from '@getir/mongo-kit';
import { startTestGrpcServer } from '@getir/service-kit/testing';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RISK_CALL_TIMEOUT_MS } from '../../../order-service/src/config/constants.js';
import {
  DEPENDENCY,
  dependencyResilience,
} from '../../../order-service/src/infrastructure/grpc-resilience.js';
import { GrpcRiskAssessment } from '../../../order-service/src/infrastructure/risk/grpc-risk-assessment.js';
import { startFreezingProxy } from '../../../../packages/mongo-kit/test/support/freezing-proxy.js';
import type { FreezingProxy } from '../../../../packages/mongo-kit/test/support/freezing-proxy.js';
import { PendingRecords } from '../../src/application/pending-records.js';
import { buildRiskService } from '../../src/bootstrap.js';
import { DEFAULT_MONGO_DB, RISK_EVENT_RECORD_TIMEOUT_MS } from '../../src/config/constants.js';
import { RISK_EVENT_METRICS } from '../../src/infrastructure/metrics/risk-event-metrics.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import { openRiskEventStore } from '../../src/infrastructure/risk-event-store.js';

const MONGO_IMAGE = 'mongo:7';
const DB_NAME = 'getir_risk_kayit_siniri';
const DELIVERY = { lat: 40.9912, lng: 29.0271 };
/** Arka plandaki kaydin dondurmaya dayanmasi icin genis islem siniri. */
const OPERATION_TIMEOUT_MS = '15000';
const RECORD_WAIT_MS = 10_000;
const POLL_INTERVAL_MS = 50;
const userOf = (n: number) => `usr_${'7'.repeat(28)}${String(n).padStart(4, '0')}`;
const orderOf = (n: number) => `ord_${'7'.repeat(28)}${String(n).padStart(4, '0')}`;

let container: StartedMongoDBContainer;
let proxy: FreezingProxy;
const closers: (() => Promise<unknown>)[] = [];

function mongoEnvThrough(port: number): MongoEnv {
  const parsed = mongoEnvSchemaFor({ prefix: 'RISK', defaultDb: DEFAULT_MONGO_DB }).safeParse({
    RISK_MONGO_URI: `mongodb://127.0.0.1:${String(port)}/?directConnection=true`,
    RISK_MONGO_DB: DB_NAME,
    MONGO_OPERATION_TIMEOUT_MS: OPERATION_TIMEOUT_MS,
  });
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
}

function request(order: number) {
  return {
    userId: userOf(1),
    orderId: orderOf(order),
    marketId: 'mkt_migros-jet-moda',
    deliveredOrderCount: 3,
    cancelledOrderCount: 0,
    basketTotalMinor: 7_990,
    currency: 'TRY',
    checkoutDwellMs: 10_000,
    deliveryLocation: DELIVERY,
    signals: {},
  };
}

beforeAll(async () => {
  container = await new MongoDBContainer(MONGO_IMAGE).start();
  proxy = await startFreezingProxy({
    host: container.getHost(),
    port: container.getMappedPort(27017),
  });
}, 120_000);

afterAll(async () => {
  for (const close of closers.reverse()) await close();
  await proxy?.close();
  await container?.stop();
});

describe('risk kaydi sure siniri, gercek Mongo (#167)', () => {
  it('Mongo donukken order istemcisi karari butcesinde alir; cozulunce kayit yine yazilir', async () => {
    const env = mongoEnvThrough(proxy.port);
    const store = await openRiskEventStore(env, silentLogger);
    closers.push(() => store.close());
    const server = await startTestGrpcServer({
      serviceName: 'risk-kayit-siniri',
      logger: silentLogger,
      services: [
        buildRiskService({
          events: store.repository,
          logger: silentLogger,
          pendingRecords: new PendingRecords(),
        }),
      ],
    });
    closers.push(() => server.stop());
    const order = new GrpcRiskAssessment(
      `127.0.0.1:${String(server.handle.port)}`,
      RISK_CALL_TIMEOUT_MS,
      dependencyResilience(DEPENDENCY.RISK, silentLogger),
    );
    closers.push(() => Promise.resolve(order.close()));
    const scope = { requestId: 'req_risk_kayit_siniri', logger: silentLogger };
    const raw = await connectMongo({
      uri: `${container.getConnectionString()}?directConnection=true`,
      dbName: DB_NAME,
    });
    closers.push(() => raw.close());
    const recorded = (orders: readonly number[]) =>
      raw.db
        .collection(COLLECTIONS.RISK_EVENTS)
        .countDocuments({ orderId: { $in: orders.map(orderOf) } });
    const waitRecorded = (orders: readonly number[], message: string) =>
      expect
        .poll(() => recorded(orders), {
          timeout: RECORD_WAIT_MS,
          interval: POLL_INTERVAL_MS,
          message,
        })
        .toBe(orders.length);
    metricsRegistry.resetMetrics();

    await expect(order.evaluate(request(1), scope)).resolves.toMatchObject({ band: 'LOW' });
    await waitRecorded([1], 'akan Mongo da kayit yazilmadi');

    proxy.freeze();
    try {
      // Ard arda uc karar: hepsi basarili (devre kesici de acilmaz); her biri kayit
      // sinirini bekler (dondurma etkili), order butcesinin altinda doner.
      for (const n of [2, 3, 4]) {
        const startedAt = performance.now();
        await expect(order.evaluate(request(n), scope)).resolves.toMatchObject({ band: 'LOW' });
        const elapsed = performance.now() - startedAt;
        expect(elapsed).toBeGreaterThanOrEqual(RISK_EVENT_RECORD_TIMEOUT_MS - 5);
        expect(elapsed).toBeLessThan(RISK_CALL_TIMEOUT_MS);
      }
      expect(await metricValue(RISK_EVENT_METRICS.TIMEOUTS)).toBe(3);
      expect(await recorded([2, 3, 4])).toBe(0);
    } finally {
      proxy.thaw();
    }

    await waitRecorded([2, 3, 4], 'donukken baslayan kayitlar cozulunce yazilmadi');
    // Metrik, kayit yazildiktan sonraki mikro adimda artar: sinirli bekleme.
    await expect
      .poll(() => metricValue(RISK_EVENT_METRICS.RECORDS, { outcome: 'late' }), {
        timeout: RECORD_WAIT_MS,
        interval: POLL_INTERVAL_MS,
        message: 'donukken baslayan kayitlar late sayilmadi',
      })
      .toBe(3);
    await expect(order.evaluate(request(5), scope)).resolves.toMatchObject({ band: 'LOW' });
    await waitRecorded([1, 2, 3, 4, 5], 'cozuldukten sonra kayit yazilmadi');
  });
});
