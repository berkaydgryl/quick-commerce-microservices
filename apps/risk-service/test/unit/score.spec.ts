/** Agirlikli skor ve kesin kural (veto). */

import { RISK_BANDS } from '@getir/core';
import { describe, expect, it } from 'vitest';

import type { RuleResult } from '../../src/domain/rule.js';
import { assessRisk } from '../../src/domain/score.js';

const result = (ruleId: string, weight: number, hit: boolean, veto = false): RuleResult => ({
  ruleId,
  hit,
  weight,
  score: hit ? weight : 0,
  reason: hit ? 'tetiklendi' : 'temiz',
  veto,
});

describe('assessRisk', () => {
  it('skor tetiklenen kurallarin agirlik toplamidir; tetiklenmeyen kural listede kalir', () => {
    const results = [result('a', 20, true), result('b', 15, true), result('c', 20, false)];

    const assessment = assessRisk(results);

    expect(assessment.score).toBe(35);
    expect(assessment.band).toBe(RISK_BANDS.MEDIUM);
    expect(assessment.hits).toHaveLength(3);
    expect(assessment.vetoedByRuleId).toBeUndefined();
  });

  it('skor 100 ile sinirlanir', () => {
    expect(assessRisk([result('a', 70, true), result('b', 70, true)]).score).toBe(100);
  });

  it('hic kural yoksa skor 0, bant LOW', () => {
    expect(assessRisk([])).toMatchObject({ score: 0, band: RISK_BANDS.LOW });
  });

  it('veto: skor dusuk olsa da bant CRITICAL, vetoyu veren kural kayitta (Ali personasi)', () => {
    const results = [
      result('ip-device', 15, true, true),
      result('checkout-dwell', 15, true),
      result('geofence', 15, true),
    ];

    const assessment = assessRisk(results);

    expect(assessment.score).toBe(45);
    expect(assessment.band).toBe(RISK_BANDS.CRITICAL);
    expect(assessment.vetoedByRuleId).toBe('ip-device');
  });

  it('tetiklenmemis kuralin veto bayragi dikkate alinmaz', () => {
    const assessment = assessRisk([result('ip-device', 15, false, true)]);
    expect(assessment.band).toBe(RISK_BANDS.LOW);
    expect(assessment.vetoedByRuleId).toBeUndefined();
  });
});
