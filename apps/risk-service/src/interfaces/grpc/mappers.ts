/**
 * Domain -> sozlesme (proto) cevirisi. Bant eslemesi Record: yeni bir bant
 * eklendiginde eksik esleme DERLEMEDE yakalanir.
 */

import { RISK_BANDS } from '@getir/core';
import type { RiskBand } from '@getir/core';
import { riskV1 } from '@getir/proto';

import type { RuleResult } from '../../domain/rule.js';

const BAND_TO_PROTO: Readonly<Record<RiskBand, riskV1.RiskBand>> = {
  [RISK_BANDS.LOW]: riskV1.RiskBand.RISK_BAND_LOW,
  [RISK_BANDS.MEDIUM]: riskV1.RiskBand.RISK_BAND_MEDIUM,
  [RISK_BANDS.HIGH]: riskV1.RiskBand.RISK_BAND_HIGH,
  [RISK_BANDS.CRITICAL]: riskV1.RiskBand.RISK_BAND_CRITICAL,
};

/** Degerlendirmenin sozlesmedeki hali; hem Evaluate hem GetLastEvaluation doner. */
export interface EvaluationView {
  readonly score: number;
  readonly band: RiskBand;
  readonly hits: readonly RuleResult[];
  readonly vetoedByRuleId?: string;
  readonly evaluatedAt: Date;
}

export function toProtoEvaluation(view: EvaluationView): riskV1.RiskEvaluation {
  return {
    score: view.score,
    band: BAND_TO_PROTO[view.band],
    hits: view.hits.map((hit) => ({
      ruleId: hit.ruleId,
      hit: hit.hit,
      weight: hit.weight,
      score: hit.score,
      reason: hit.reason,
      veto: hit.veto,
    })),
    evaluatedAt: view.evaluatedAt,
    vetoedByRuleId: view.vetoedByRuleId ?? '',
  };
}
