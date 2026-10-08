/**
 * #167 kapi testi: risk_events deposu takilsa da (Mongo donmasi) Evaluate
 * karari KAYIT SINIRINDA doner: sinirdan 1 ms once cevap yok, sinirda var.
 * Servis kurulumunun (bootstrap) gRPC isleyicisi dogrudan cagrilir; istek
 * telden gecmis gibi kodlanip cozulur. Sahte saat (tasima katmani yok: gRPC'nin
 * kendi zamanlayicilari sahte saatle durur). Butce iliskisi order-service'in
 * GERCEK sabitiyle denetlenir.
 */

import { fixedClock } from '@getir/core';
import { riskV1 } from '@getir/proto';
import { Metadata } from '@grpc/grpc-js';
import type { handleUnaryCall, sendUnaryData, ServerUnaryCall } from '@grpc/grpc-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RISK_CALL_TIMEOUT_MS } from '../../../order-service/src/config/constants.js';
import { PendingRecords } from '../../src/application/pending-records.js';
import { buildRiskService } from '../../src/bootstrap.js';
import { RISK_EVENT_RECORD_TIMEOUT_MS, RULE_TIMEOUT_MS } from '../../src/config/constants.js';
import type { RiskEventRepository } from '../../src/domain/risk-event-repository.js';
import { PERSONA_NOW, PERSONAS } from '../support/personas.js';
import { toProtoContext } from '../support/proto-context.js';

/** Kaydi hic bitmeyen depo: donmus Mongo. */
const frozen: RiskEventRepository = {
  insert: () => new Promise<void>(() => undefined),
  findLatest: () => Promise.resolve(null),
};

type EvaluateHandler = handleUnaryCall<riskV1.EvaluateRequest, riskV1.EvaluateResponse>;

afterEach(() => {
  vi.useRealTimers();
});

describe('Evaluate: kayit donsa da karar sinirda doner (#167)', () => {
  it('kural + kayit sinirlari toplami order butcesinin (gercek sabit) yarisinin altinda', () => {
    expect(RULE_TIMEOUT_MS + RISK_EVENT_RECORD_TIMEOUT_MS).toBeLessThan(RISK_CALL_TIMEOUT_MS / 2);
  });

  it('donmus depoyla: sinirdan 1 ms once cevap yok, sinirda karar doner (hata yok, skor dogru)', async () => {
    const persona = PERSONAS[0];
    if (persona === undefined) throw new Error('persona yok');
    vi.useFakeTimers();
    const registration = buildRiskService({
      clock: fixedClock(PERSONA_NOW),
      events: frozen,
      pendingRecords: new PendingRecords(),
    });
    const evaluate = registration.implementation['evaluate'] as EvaluateHandler;
    const request = riskV1.EvaluateRequest.decode(
      riskV1.EvaluateRequest.encode({ context: toProtoContext(persona.context) }).finish(),
    );
    const call = {
      request,
      metadata: new Metadata(),
      getPath: () => '/getir.risk.v1.RiskService/Evaluate',
    } as unknown as ServerUnaryCall<riskV1.EvaluateRequest, riskV1.EvaluateResponse>;
    let answer: Parameters<sendUnaryData<riskV1.EvaluateResponse>> | undefined;

    evaluate(call, (...args) => {
      answer = args;
    });
    await vi.advanceTimersByTimeAsync(RISK_EVENT_RECORD_TIMEOUT_MS - 1);
    expect(answer).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);

    expect(answer?.[0]).toBeNull();
    expect(answer?.[1]?.evaluation?.score).toBe(persona.expected.score);
  });
});
