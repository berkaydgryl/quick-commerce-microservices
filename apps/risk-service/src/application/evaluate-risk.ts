/**
 * EvaluateRisk use-case: kayitli kurallari PARALEL kosturur, sonuclari skora
 * ve banda indirir.
 *
 * Tek bir kuralin hatasi ya da takilmasi degerlendirmeyi DUSURMEZ: o kural
 * 0 puan sayilir ve uyari gunluge yazilir. Risk motorunun yuzunden siparis
 * akisinin durmasi kabul edilemez (proto EvaluateResponse sozlesmesi).
 */

import type { Clock, Logger } from '@getir/core';

import type { RiskContext } from '../domain/risk-context.js';
import type { RuleResult } from '../domain/rule.js';
import { assessRisk } from '../domain/score.js';
import type { RiskAssessment } from '../domain/score.js';
import type { RegisteredRule } from '../rules/registry.js';
import { withTimeout } from './with-timeout.js';

export interface EvaluateRiskDeps {
  readonly rules: readonly RegisteredRule[];
  readonly clock: Clock;
  readonly ruleTimeoutMs: number;
  readonly logger?: Logger;
}

export interface RiskEvaluation extends RiskAssessment {
  readonly evaluatedAt: Date;
}

export type EvaluateRisk = (context: RiskContext) => Promise<RiskEvaluation>;

/** Kosmayan kuralin gerekcesi: risk_events'te "tetiklenmedi" ile karismasin. */
const FAILED_RULE_REASON = 'kural hatasi';

export function createEvaluateRisk(deps: EvaluateRiskDeps): EvaluateRisk {
  return async (context) => {
    const results = await Promise.all(deps.rules.map((entry) => runRule(deps, entry, context)));
    return { ...assessRisk(results), evaluatedAt: deps.clock.date() };
  };
}

async function runRule(
  deps: EvaluateRiskDeps,
  { rule, weight, severity }: RegisteredRule,
  context: RiskContext,
): Promise<RuleResult> {
  try {
    // Promise.resolve().then: kural senkron firlatsa da ayni yoldan yakalanir.
    const outcome = await withTimeout(
      Promise.resolve().then(() => rule.evaluate(context)),
      deps.ruleTimeoutMs,
      `risk kurali ${rule.id}`,
    );
    const vetoRequested = outcome.hit && outcome.veto === true;
    if (vetoRequested && severity !== 'block') {
      // Yetkisiz veto: kural kendine engelleme yetkisi veremez; puan sayilir.
      deps.logger?.warn({ ruleId: rule.id }, 'veto yetkisi olmayan kural veto istedi, yok sayildi');
    }
    return {
      ruleId: rule.id,
      hit: outcome.hit,
      weight,
      score: outcome.hit ? weight : 0,
      reason: outcome.reason,
      veto: vetoRequested && severity === 'block',
    };
  } catch (error) {
    deps.logger?.warn({ ruleId: rule.id, err: error }, 'risk kurali hata verdi, 0 puan sayildi');
    return {
      ruleId: rule.id,
      hit: false,
      weight,
      score: 0,
      reason: FAILED_RULE_REASON,
      veto: false,
    };
  }
}
