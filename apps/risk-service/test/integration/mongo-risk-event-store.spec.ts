/**
 * risk_events'in Mongo uygulamasi - gercek Mongo (Testcontainers).
 *   1. Sozlesme: bellek deposuyla AYNI senaryolar gercek sorguda.
 *   2. Indeksler: userId+createdAt ve (kismi) orderId+createdAt kurulu; en-yeni
 *      sorgusu indeksten sirali okunur.
 *   3. T6.3 "bitti sayilir": servis Mongo ile kurulur, Evaluate'in karari
 *      koleksiyonda gorulur ve GetLastEvaluation ile sorgulanir.
 */

import { fixedClock, RISK_BANDS } from '@getir/core';
import { connectMongo } from '@getir/mongo-kit';
import type { MongoConnection } from '@getir/mongo-kit';
import { riskV1 } from '@getir/proto';
import { startTestGrpcServer } from '@getir/service-kit/testing';
import type { TestGrpcServer, UnaryCall } from '@getir/service-kit/testing';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildRiskService } from '../../src/bootstrap.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import type { RiskEventDocument } from '../../src/infrastructure/mongo/documents.js';
import { RiskEventMongoStore } from '../../src/infrastructure/mongo/risk-event-mongo-store.js';
import {
  highestRecentQuery,
  RiskEventsCollection,
} from '../../src/infrastructure/mongo/risk-events-collection.js';
import { PERSONA_NOW, PERSONAS } from '../support/personas.js';
import { toProtoContext } from '../support/proto-context.js';
import { describeRiskEventStoreContract } from '../support/risk-event-store-contract.js';

const MONGO_IMAGE = 'mongo:7';
const DB_NAME = 'getir_risk_test';

let container: StartedMongoDBContainer;
let connection: MongoConnection;
let store: RiskEventMongoStore;

beforeAll(async () => {
  container = await new MongoDBContainer(MONGO_IMAGE).start();
  connection = await connectMongo({
    uri: `${container.getConnectionString()}?directConnection=true`,
    dbName: DB_NAME,
    // Uretimdeki gibi sureli (#51): toplu yazim ve transaction bu ayarla kosar.
    operationTimeoutMs: 2_000,
  });
  const events = new RiskEventsCollection(connection.db);
  await events.ensureIndexes();
  store = new RiskEventMongoStore(events);
});

afterAll(async () => {
  await connection.close();
  await container.stop();
});

describeRiskEventStoreContract('mongo', () => store);

describe('indeksler', () => {
  it('userId+createdAt ve kismi orderId+createdAt kurulu', async () => {
    const indexes = await connection.db.collection(COLLECTIONS.RISK_EVENTS).indexes();
    const byName = (name: string) => indexes.find((index) => index.name === name);

    expect(byName('userId_createdAt')?.key).toEqual({ userId: 1, createdAt: -1 });
    expect(byName('orderId_createdAt')?.key).toEqual({ orderId: 1, createdAt: -1 });
    expect(byName('orderId_createdAt')?.partialFilterExpression).toEqual({
      orderId: { $exists: true },
    });
  });

  it('yakin bant sorgusu (#164) userId_createdAt indeksiyle suzer; COLLSCAN yok', async () => {
    const { filter, sort } = highestRecentQuery('usr_explain', new Date(PERSONA_NOW));

    const plan = await connection.db
      .collection(COLLECTIONS.RISK_EVENTS)
      .find(filter)
      .sort(sort)
      .limit(1)
      .explain('queryPlanner');

    const winning = JSON.stringify((plan['queryPlanner'] as { winningPlan?: unknown }).winningPlan);
    expect(winning).toContain('IXSCAN');
    expect(winning).toContain('userId_createdAt');
    expect(winning).not.toContain('COLLSCAN');
  });
});

describe('T6.3: Evaluate kaydi Mongo da gorulur ve sorgulanir', () => {
  let server: TestGrpcServer | undefined;

  const call: UnaryCall = (method, request, metadata) =>
    server === undefined
      ? Promise.reject(new Error('test sunucusu henuz baslamadi'))
      : server.call(method, request, metadata);

  beforeAll(async () => {
    server = await startTestGrpcServer({
      serviceName: 'risk-int',
      services: [buildRiskService({ events: store, clock: fixedClock(PERSONA_NOW) })],
    });
  });

  afterAll(async () => {
    await server?.stop();
  });

  it('Can (HIGH) ve Ali (veto) degerlendirmeleri koleksiyona yazilir, ham baglam yazilmaz', async () => {
    const can = PERSONAS.find((persona) => persona.name.startsWith('Can'));
    const ali = PERSONAS.find((persona) => persona.name.startsWith('Ali'));
    if (can === undefined || ali === undefined) throw new Error('persona yok');

    await call(riskV1.RiskServiceService.evaluate, {
      context: { ...toProtoContext(can.context), orderId: 'ord_can-1' },
    });
    await call(riskV1.RiskServiceService.evaluate, {
      context: { ...toProtoContext(ali.context), orderId: 'ord_ali-1', deviceId: 'dev_gizli' },
    });

    const raw = await connection.db
      .collection<RiskEventDocument>(COLLECTIONS.RISK_EVENTS)
      .findOne({ orderId: 'ord_ali-1' });

    expect(raw).toMatchObject({
      userId: ali.context.userId,
      score: 45,
      band: RISK_BANDS.CRITICAL,
      vetoedByRuleId: 'ip-device',
      createdAt: new Date(PERSONA_NOW),
    });
    expect(raw?.rules).toHaveLength(6);
    expect(JSON.stringify(raw)).not.toMatch(/dev_gizli|10\.0\.0\.1|38\.42|40\.98/);
  });

  it('GetLastEvaluation kaydi okur: "Can neden incelemede?"', async () => {
    const { error, response } = await call(riskV1.RiskServiceService.getLastEvaluation, {
      userId: 'usr_can',
      orderId: 'ord_can-1',
    });

    expect(error).toBeUndefined();
    expect(response?.evaluation?.band).toBe(riskV1.RiskBand.RISK_BAND_HIGH);
    expect(response?.evaluation?.hits.filter((hit) => hit.hit).map((hit) => hit.ruleId)).toEqual([
      'account-age',
      'order-history',
      'basket-anomaly',
      'geofence',
    ]);
  });
});
