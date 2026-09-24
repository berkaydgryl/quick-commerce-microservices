/**
 * config/risk.rules.json: sema ve T6.1 kararlari. Agirlik ya da esik
 * degisirse bu testler karari yeniden sorgulatir.
 */

import { describe, expect, it } from 'vitest';

import { parseRiskRulesConfig } from '../../src/config/rule-config.js';
import { riskRulesConfig } from '../../src/config/risk-rules.js';
import { BAND_LOWER_BOUNDS } from '../../src/domain/bands.js';

const weights = Object.values(riskRulesConfig).map((rule) => rule.weight);
const total = weights.reduce((sum, weight) => sum + weight, 0);

describe('risk.rules.json', () => {
  it('alti cekirdek kuralin hepsi acik; agirliklar toplami 100', () => {
    expect(Object.keys(riskRulesConfig).sort()).toEqual([
      'account-age',
      'basket-anomaly',
      'checkout-dwell',
      'geofence',
      'ip-device',
      'order-history',
    ]);
    expect(Object.values(riskRulesConfig).every((rule) => rule.enabled)).toBe(true);
    expect(total).toBe(100);
  });

  it('yalnizca ip-device veto edebilir (cihazda 3+ hesap)', () => {
    const blockers = Object.entries(riskRulesConfig)
      .filter(([, rule]) => rule.severity === 'block')
      .map(([id]) => id);
    expect(blockers).toEqual(['ip-device']);
  });

  it('T6.1 bulgusu: veto olmadan kritik banda en az bes kural gerekir, dort kural yetmez', () => {
    const descending = [...weights].sort((a, b) => b - a);
    const bestOf = (count: number): number => descending.slice(0, count).reduce((s, w) => s + w, 0);

    expect(bestOf(4)).toBeLessThan(BAND_LOWER_BOUNDS.CRITICAL);
    expect(total - Math.max(...weights)).toBeGreaterThanOrEqual(BAND_LOWER_BOUNDS.CRITICAL);
  });
});

describe('parseRiskRulesConfig', () => {
  it.each([
    ['agirlik 100 ustu', { 'ip-device': { weight: 150, enabled: true, severity: 'score' } }],
    ['bilinmeyen ciddiyet', { 'ip-device': { weight: 15, enabled: true, severity: 'veto' } }],
    ['kebab-case olmayan kimlik', { ipDevice: { weight: 15, enabled: true, severity: 'score' } }],
    [
      'bilinmeyen alan (yazim hatasi)',
      { 'ip-device': { weight: 15, enabled: true, severity: 'score', wieght: 1 } },
    ],
    ['eksik alan', { 'ip-device': { weight: 15, severity: 'score' } }],
  ])('reddeder: %s', (_, raw) => {
    expect(() => parseRiskRulesConfig(raw)).toThrow(/risk\.rules\.json gecersiz/);
  });
});
