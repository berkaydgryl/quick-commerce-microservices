/**
 * Kural kaydi: yazilmis kurallari config ile eslestirir.
 *
 * Eslesme IKI YONDE de zorunludur ve acilista dogrulanir:
 *  - config'i olmayan kural: agirliksiz kalir, "kostu ama hic puan vermedi"
 *    sessiz hatasi olurdu;
 *  - kurali olmayan config satiri: yazim hatasi ("ip-devices") kural calisiyor
 *    sanilir ama hic kosmaz.
 * Kapali (enabled: false) kural listeye girmez.
 */

import type { RiskRulesConfig } from '../config/rule-config.js';
import type { Rule, RuleSeverity } from '../domain/rule.js';

export interface RegisteredRule {
  readonly rule: Rule;
  readonly weight: number;
  readonly severity: RuleSeverity;
}

export function createRuleRegistry(
  rules: readonly Rule[],
  config: RiskRulesConfig,
): readonly RegisteredRule[] {
  const ids = rules.map((rule) => rule.id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  const withoutConfig = ids.filter((id) => config[id] === undefined);
  const withoutRule = Object.keys(config).filter((id) => !ids.includes(id));

  const problems = [
    ...duplicates.map((id) => `ayni kimlikle iki kural: ${id}`),
    ...withoutConfig.map((id) => `config'i olmayan kural: ${id}`),
    ...withoutRule.map((id) => `kurali olmayan config satiri: ${id}`),
  ];
  if (problems.length > 0) {
    throw new Error(`Risk kural kaydi gecersiz - ${problems.join('; ')}`);
  }

  return rules.flatMap((rule) => {
    const settings = config[rule.id];
    return settings?.enabled === true
      ? [{ rule, weight: settings.weight, severity: settings.severity }]
      : [];
  });
}
