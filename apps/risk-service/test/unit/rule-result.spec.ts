/**
 * Kural sonucu (D10): saf fonksiyonlar - ag, saat, gunluk ve zamanlayici yok.
 * Kosturma ve izolasyon (paralel, sure siniri, hata) evaluate-risk.spec.ts'te.
 */

import { describe, expect, it } from 'vitest';

import type { RuleSeverity } from '../../src/domain/rule.js';
import {
  FAILED_RULE_REASON,
  failedRuleResult,
  isUnauthorizedVeto,
  toRuleResult,
} from '../../src/domain/rule-result.js';

describe('toRuleResult: puan', () => {
  it('tetiklenen kural agirligi kadar puan verir; gerekce aynen tasinir', () => {
    expect(
      toRuleResult('account-age', { hit: true, reason: 'hesap 4 saatlik' }, 20, 'score'),
    ).toEqual({
      ruleId: 'account-age',
      hit: true,
      weight: 20,
      score: 20,
      reason: 'hesap 4 saatlik',
      veto: false,
    });
  });

  it('tetiklenmeyen kural 0 puan; agirlik yine kayitta (proto RuleHit)', () => {
    expect(
      toRuleResult('geofence', { hit: false, reason: 'ayni sehir' }, 15, 'score'),
    ).toMatchObject({ hit: false, weight: 15, score: 0 });
  });
});

describe('toRuleResult ve isUnauthorizedVeto: veto yetkisi', () => {
  it.each<[string, boolean, boolean | undefined, RuleSeverity, boolean, boolean]>([
    // [ad, hit, veto istegi, ciddiyet, sonuc veto, yetkisiz istek]
    ['yetkili kural tetiklenip veto ister', true, true, 'block', true, false],
    ['yetkisiz kural tetiklenip veto ister', true, true, 'score', false, true],
    ['yetkili kural tetiklenmeden veto ister', false, true, 'block', false, false],
    ['yetkisiz kural tetiklenmeden veto ister', false, true, 'score', false, false],
    ['yetkili kural veto istemez', true, false, 'block', false, false],
    ['veto alani hic yok', true, undefined, 'block', false, false],
  ])('%s', (_name, hit, veto, severity, expectedVeto, unauthorized) => {
    const outcome = veto === undefined ? { hit, reason: 'x' } : { hit, reason: 'x', veto };

    expect(toRuleResult('ip-device', outcome, 15, severity).veto).toBe(expectedVeto);
    expect(isUnauthorizedVeto(outcome, severity)).toBe(unauthorized);
  });

  it('yetkisiz veto puani engellemez: tetiklenen kural agirligini yine verir', () => {
    expect(
      toRuleResult('geofence', { hit: true, reason: 'x', veto: true }, 15, 'score'),
    ).toMatchObject({ score: 15, veto: false });
  });
});

describe('failedRuleResult', () => {
  it('kosmayan kural 0 puan, veto yok; gerekce "tetiklenmedi" ile karismaz', () => {
    expect(failedRuleResult('basket-anomaly', 20)).toEqual({
      ruleId: 'basket-anomaly',
      hit: false,
      weight: 20,
      score: 0,
      reason: FAILED_RULE_REASON,
      veto: false,
    });
  });
});
