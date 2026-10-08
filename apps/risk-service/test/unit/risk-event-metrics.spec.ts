/**
 * risk_events kaydinin metrikleri (#167): servis kurulumundan (bootstrap) gercek
 * telden. records_total kayit basina TEK nihai sonuc (recorded | late |
 * failed); sinir asimi ayri sayac (timeouts_total). Etiket yalniz sonuctur.
 */

import { fixedClock } from '@getir/core';
import { metricsRegistry } from '@getir/observability';
import { metricValue } from '@getir/observability/testing';
import { riskV1 } from '@getir/proto';
import { startTestGrpcServer } from '@getir/service-kit/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { RECORD_EVENT } from '../../src/application/evaluate-and-record.js';
import { PendingRecords } from '../../src/application/pending-records.js';
import { buildRiskService } from '../../src/bootstrap.js';
import type { RiskEventRepository } from '../../src/domain/risk-event-repository.js';
import { InMemoryRiskEventStore } from '../../src/infrastructure/memory/in-memory-risk-event-store.js';
import { RISK_EVENT_METRICS } from '../../src/infrastructure/metrics/risk-event-metrics.js';
import { PERSONA_NOW, PERSONAS } from '../support/personas.js';
import { toProtoContext } from '../support/proto-context.js';

/** Gercek tel uzerinden: sinir kisa tutulur, sonuca sinir degil olay sirasi bakar. */
const RECORD_TIMEOUT_MS = 20;

beforeEach(() => {
  metricsRegistry.resetMetrics();
});

async function evaluateOnce(events: RiskEventRepository, pending = new PendingRecords()) {
  const persona = PERSONAS[0];
  if (persona === undefined) throw new Error('persona yok');
  const server = await startTestGrpcServer({
    serviceName: 'risk-metrik',
    services: [
      buildRiskService({
        clock: fixedClock(PERSONA_NOW),
        events,
        recordTimeoutMs: RECORD_TIMEOUT_MS,
        pendingRecords: pending,
      }),
    ],
  });
  try {
    const { error } = await server.call(riskV1.RiskServiceService.evaluate, {
      context: toProtoContext(persona.context),
    });
    expect(error).toBeUndefined();
  } finally {
    await server.stop();
  }
}

const outcome = async (value: string) =>
  (await metricValue(RISK_EVENT_METRICS.RECORDS, { outcome: value })) ?? 0;
const timeouts = async () => (await metricValue(RISK_EVENT_METRICS.TIMEOUTS)) ?? 0;

describe('risk_event_records_total ve risk_event_record_timeouts_total', () => {
  it('servis kurulunca sonuc serileri 0 ile acilir (ilk kayip da oran olarak gorunur)', async () => {
    buildRiskService({
      events: new InMemoryRiskEventStore(),
      pendingRecords: new PendingRecords(),
    });

    for (const value of [RECORD_EVENT.RECORDED, RECORD_EVENT.LATE, RECORD_EVENT.FAILED]) {
      expect(await metricValue(RISK_EVENT_METRICS.RECORDS, { outcome: value })).toBe(0);
    }
    expect(await metricValue(RISK_EVENT_METRICS.TIMEOUTS)).toBe(0);
  });

  it('zamaninda kayit: recorded, sinir asimi yok', async () => {
    await evaluateOnce(new InMemoryRiskEventStore());

    expect(await outcome(RECORD_EVENT.RECORDED)).toBe(1);
    expect(await timeouts()).toBe(0);
  });

  it('hemen dusen kayit: failed (sinir asimi yok)', async () => {
    await evaluateOnce({
      insert: () => Promise.reject(new Error('mongo yok')),
      findLatest: () => Promise.resolve(null),
    });

    expect(await outcome(RECORD_EVENT.FAILED)).toBe(1);
    expect(await timeouts()).toBe(0);
  });

  it('sinirdan sonra yazilan kayit: timeouts 1, sonuc late (recorded degil)', async () => {
    let finish: () => void = () => undefined;
    await evaluateOnce({
      insert: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      findLatest: () => Promise.resolve(null),
    });
    expect(await timeouts()).toBe(1);
    expect(await outcome(RECORD_EVENT.LATE)).toBe(0);

    finish();
    await new Promise((resolve) => setImmediate(resolve));

    expect(await outcome(RECORD_EVENT.LATE)).toBe(1);
    expect(await outcome(RECORD_EVENT.RECORDED)).toBe(0);
  });

  it('kapanista yarim kalan kayit: timeouts 1, sonuc failed (bir kez)', async () => {
    const pending = new PendingRecords();
    await evaluateOnce(
      { insert: () => new Promise<void>(() => undefined), findLatest: () => Promise.resolve(null) },
      pending,
    );

    expect(await pending.drain(0)).toBe(1);

    expect(await timeouts()).toBe(1);
    expect(await outcome(RECORD_EVENT.FAILED)).toBe(1);
  });
});
