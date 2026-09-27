/**
 * Kural sonucunun saf kurallari (D10): kuralin cevabi + config'teki agirlik ve
 * ciddiyet -> kayda gecen sonuc (proto RuleHit). I/O yok; kuralin kosturulmasi,
 * sure siniri ve gunluk application/evaluate-risk.ts'tedir.
 *
 *   puan : tetiklendiyse agirlik, degilse 0
 *   veto : YALNIZCA tetiklenmis, veto isteyen ve config'te severity "block"
 *          olan kuralda gecerli. Kural kendine engelleme yetkisi veremez.
 */

import type { RuleOutcome, RuleResult, RuleSeverity } from './rule.js';

/**
 * Kosmayan (hata veren ya da suresi dolan) kuralin gerekcesi: risk_events'te
 * "tetiklenmedi" ile karismasin.
 */
export const FAILED_RULE_REASON = 'kural hatasi';

/** Kuralin cevabini agirlik ve veto yetkisiyle sonuca cevirir. */
export function toRuleResult(
  ruleId: string,
  outcome: RuleOutcome,
  weight: number,
  severity: RuleSeverity,
): RuleResult {
  return {
    ruleId,
    hit: outcome.hit,
    weight,
    score: outcome.hit ? weight : 0,
    reason: outcome.reason,
    veto: requestsVeto(outcome) && severity === 'block',
  };
}

/**
 * Yetkisiz veto istegi: tetiklenen kural veto istedi ama config'te "block"
 * yetkisi yok. Istek YOK SAYILIR (puan yine sayilir); cagiran uyari yazar ki
 * yanlis ayarlanmis kural fark edilsin.
 */
export function isUnauthorizedVeto(outcome: RuleOutcome, severity: RuleSeverity): boolean {
  return requestsVeto(outcome) && severity !== 'block';
}

/**
 * Hata veren ya da suresi dolan kural 0 puan sayilir: risk motorunun bir
 * kurali yuzunden siparis akisi durmaz (proto EvaluateResponse sozlesmesi).
 */
export function failedRuleResult(ruleId: string, weight: number): RuleResult {
  return { ruleId, hit: false, weight, score: 0, reason: FAILED_RULE_REASON, veto: false };
}

/** Tetiklenmeyen kuralin veto istegi anlamsizdir. */
function requestsVeto(outcome: RuleOutcome): boolean {
  return outcome.hit && outcome.veto === true;
}
