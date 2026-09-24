/** Kural kaydi: config ile IKI YONLU eslesme, kapali kural disarida. */

import { describe, expect, it } from 'vitest';

import type { RiskRulesConfig } from '../../src/config/rule-config.js';
import type { Rule } from '../../src/domain/rule.js';
import { createRuleRegistry } from '../../src/rules/registry.js';

const rule = (id: string): Rule => ({
  id,
  evaluate: () => Promise.resolve({ hit: false, reason: 'temiz' }),
});

const config: RiskRulesConfig = {
  'account-age': { weight: 20, enabled: true, severity: 'score' },
  'ip-device': { weight: 15, enabled: true, severity: 'block' },
};

describe('createRuleRegistry', () => {
  it('agirlik ve ciddiyeti config ten baglar, kural sirasini korur', () => {
    const registry = createRuleRegistry([rule('account-age'), rule('ip-device')], config);

    expect(registry.map((entry) => [entry.rule.id, entry.weight, entry.severity])).toEqual([
      ['account-age', 20, 'score'],
      ['ip-device', 15, 'block'],
    ]);
  });

  it('kapali kural listeye girmez', () => {
    const registry = createRuleRegistry([rule('account-age'), rule('ip-device')], {
      ...config,
      'account-age': { weight: 20, enabled: false, severity: 'score' },
    });
    expect(registry.map((entry) => entry.rule.id)).toEqual(['ip-device']);
  });

  it("config'i olmayan kural acilisi durdurur", () => {
    expect(() =>
      createRuleRegistry([rule('account-age'), rule('ip-device'), rule('geofence')], config),
    ).toThrow("config'i olmayan kural: geofence");
  });

  it('kurali olmayan config satiri (yazim hatasi) acilisi durdurur', () => {
    expect(() => createRuleRegistry([rule('account-age')], config)).toThrow(
      'kurali olmayan config satiri: ip-device',
    );
  });

  it('ayni kimlikle iki kural acilisi durdurur', () => {
    expect(() =>
      createRuleRegistry([rule('account-age'), rule('account-age'), rule('ip-device')], config),
    ).toThrow('ayni kimlikle iki kural: account-age');
  });
});
