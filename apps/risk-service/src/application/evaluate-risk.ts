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
import { failedRuleResult, isUnauthorizedVeto, toRuleResult } from '../domain/rule-result.js';
import { assessRisk } from '../domain/score.js';
import type { RiskAssessment } from '../domain/score.js';
import type { RegisteredRule } from '../rules/registry.js';
import { withTimeout } from './with-timeout.js';

export interface EvaluateRiskDeps {
  readonly rules: readonly RegisteredRule[];
  readonly clock: Clock;
  readonly ruleTimeoutMs: number;
}

export interface RiskEvaluation extends RiskAssessment {
  readonly evaluatedAt: Date;
}

/**
 * `logger` CAGRININ gunlukcusudur (rpc + requestId bagli): hata veren kuralin
 * uyarisi hangi degerlendirmeye ait oldugunu tasimali.
 */
export type EvaluateRisk = (context: RiskContext, logger: Logger) => Promise<RiskEvaluation>;

export function createEvaluateRisk(deps: EvaluateRiskDeps): EvaluateRisk {
  return async (context, logger) => {
    const results = await Promise.all(
      deps.rules.map((entry) => runRule(deps, entry, context, logger)),
    );
    return { ...assessRisk(results), evaluatedAt: deps.clock.date() };
  };
}

/**
 * Tek kuralin ORKESTRASYONU: sure siniriyla kostur, sonucu domain kuralina
 * cevir (rule-result.ts), gerekirse uyari yaz. Puan ve veto karari burada
 * VERILMEZ.
 */
async function runRule(
  deps: EvaluateRiskDeps,
  { rule, weight, severity }: RegisteredRule,
  context: RiskContext,
  logger: Logger,
): Promise<RuleResult> {
  try {
    // Promise.resolve().then: kural senkron firlatsa da ayni yoldan yakalanir.
    const outcome = await withTimeout(
      Promise.resolve().then(() => rule.evaluate(context)),
      deps.ruleTimeoutMs,
      `risk kurali ${rule.id}`,
    );
    if (isUnauthorizedVeto(outcome, severity)) {
      logger.warn({ ruleId: rule.id }, 'veto yetkisi olmayan kural veto istedi, yok sayildi');
    }
    return toRuleResult(rule.id, outcome, weight, severity);
  } catch (error) {
    logger.warn({ ruleId: rule.id, err: error }, 'risk kurali hata verdi, 0 puan sayildi');
    return failedRuleResult(rule.id, weight);
  }
}
