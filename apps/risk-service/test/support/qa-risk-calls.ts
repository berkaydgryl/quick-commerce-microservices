/**
 * QA (T15.2, risk geriye donuk PR 2): risk gRPC'sine Evaluate cagrisi ve tetiklenen kurallar. Kural
 * ve kayit testleri (qa-risk-rules-bands, qa-risk-events) ayni cagriyi kullanir.
 */

import { riskV1 } from '@getir/proto';
import type { TestGrpcServer } from '@getir/service-kit/testing';

import type { RiskContext } from '../../src/domain/risk-context.js';
import { toProtoContext } from './proto-context.js';

/** Baglami telden degerlendirir (proto donusumu proto-context.ts); karar yoksa firlatir. */
export async function evaluate(
  server: TestGrpcServer,
  context: RiskContext,
): Promise<riskV1.RiskEvaluation> {
  const { response, error } = await server.call(riskV1.RiskServiceService.evaluate, {
    context: toProtoContext(context),
  });
  if (response?.evaluation === undefined) {
    throw new Error(`degerlendirme yok: ${error?.message ?? ''}`);
  }
  return response.evaluation;
}

/** Tetiklenen kurallar, sirali. */
export function fired(evaluation: Pick<riskV1.RiskEvaluation, 'hits'>): string[] {
  return evaluation.hits
    .filter((hit) => hit.hit)
    .map((hit) => hit.ruleId)
    .sort();
}
