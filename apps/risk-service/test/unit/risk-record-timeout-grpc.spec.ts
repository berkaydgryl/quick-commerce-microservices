/**
 * #167 kapi testi: risk_events deposu takilsa da (Mongo donmasi) Evaluate karari
 * gercek telden doner; kayit siniri uretimdeki deger. Order'in gercek istemcisi
 * ve butcesiyle olcum entegrasyon testindedir (risk-record-timeout.spec.ts);
 * burada servis disi kaynak kullanilmaz.
 */

import { fixedClock } from '@getir/core';
import { riskV1 } from '@getir/proto';
import { startTestGrpcServer } from '@getir/service-kit/testing';
import type { TestGrpcServer } from '@getir/service-kit/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildRiskService } from '../../src/bootstrap.js';
import { RISK_EVENT_RECORD_TIMEOUT_MS, RULE_TIMEOUT_MS } from '../../src/config/constants.js';
import type { RiskEventRepository } from '../../src/domain/risk-event-repository.js';
import { PERSONA_NOW, PERSONAS } from '../support/personas.js';
import { toProtoContext } from '../support/proto-context.js';

/** Order'in risk butcesi (order-service RISK_CALL_TIMEOUT_MS); gercek degeri entegrasyon testi okur. */
const ORDER_RISK_BUDGET_MS = 1_000;

/** Kaydi hic bitmeyen depo: donmus Mongo. */
const frozen: RiskEventRepository = {
  insert: () => new Promise<void>(() => undefined),
  findLatest: () => Promise.resolve(null),
};

let server: TestGrpcServer | undefined;

beforeAll(async () => {
  server = await startTestGrpcServer({
    serviceName: 'risk-donmus-kayit',
    services: [buildRiskService({ clock: fixedClock(PERSONA_NOW), events: frozen })],
  });
});

afterAll(async () => {
  await server?.stop();
});

describe('Evaluate: kayit donsa da karar doner (#167)', () => {
  it('kural + kayit sinirlari toplami order butcesinin yarisinin altinda', () => {
    expect(RULE_TIMEOUT_MS + RISK_EVENT_RECORD_TIMEOUT_MS).toBeLessThan(ORDER_RISK_BUDGET_MS / 2);
  });

  it('donmus depoyla karar gercek telden doner (hata yok, skor dogru, butcenin altinda)', async () => {
    const persona = PERSONAS[0];
    if (persona === undefined || server === undefined) throw new Error('kurulum yok');
    const startedAt = performance.now();

    const { error, response } = await server.call(riskV1.RiskServiceService.evaluate, {
      context: toProtoContext(persona.context),
    });

    expect(error).toBeUndefined();
    expect(response?.evaluation?.score).toBe(persona.expected.score);
    // Bekleme yalnizca kayit siniri (200 ms); ust sinir butce, 5 kat pay.
    expect(performance.now() - startedAt).toBeLessThan(ORDER_RISK_BUDGET_MS);
  });
});
