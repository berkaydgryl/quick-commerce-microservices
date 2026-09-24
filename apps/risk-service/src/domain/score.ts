/**
 * Agirlikli skor ve bant: kural sonuclarini tek karara indirir. Saf fonksiyon.
 *
 * Skor tetiklenen kurallarin agirlik toplamidir, 0-100'e sikistirilir. Bant
 * skordan gelir; ancak bir kural VETO ettiyse skor ne olursa olsun CRITICAL
 * olur ve vetoyu veren kural kayda gecer ("skor 45, cihazda 3+ hesap").
 */

import { RISK_BANDS } from '@getir/core';
import type { RiskBand } from '@getir/core';

import { bandForScore, MAX_SCORE, MIN_SCORE } from './bands.js';
import type { RuleResult } from './rule.js';

export interface RiskAssessment {
  readonly score: number;
  readonly band: RiskBand;
  readonly hits: readonly RuleResult[];
  /** Bandi veto ile CRITICAL yapan ilk kural; yoksa undefined. */
  readonly vetoedByRuleId?: string;
}

export function assessRisk(results: readonly RuleResult[]): RiskAssessment {
  const total = results.reduce((sum, result) => sum + result.score, 0);
  const score = Math.min(Math.max(total, MIN_SCORE), MAX_SCORE);
  const vetoer = results.find((result) => result.hit && result.veto);

  return vetoer === undefined
    ? { score, band: bandForScore(score), hits: results }
    : { score, band: RISK_BANDS.CRITICAL, hits: results, vetoedByRuleId: vetoer.ruleId };
}
