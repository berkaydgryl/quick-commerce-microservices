/**
 * config/risk.rules.json: kural basina agirlik, acik/kapali ve ciddiyet.
 *
 * Dosya DIS VERI sayilir ve Zod'dan gecer (ADR-10): yanlis yazilmis bir
 * agirlik ya da ciddiyet servisi ACILISTA durdurur, sessizce 0 puana donmez.
 */

import { z } from 'zod';

import { MAX_SCORE } from '../domain/bands.js';

/** Kural kimligi: kebab-case (dosya adi ve risk_events ile ayni). */
const ruleIdSchema = z.string().regex(/^[a-z]+(-[a-z]+)*$/, 'kebab-case olmali');

const ruleConfigSchema = z
  .object({
    weight: z.number().int().min(0).max(MAX_SCORE),
    enabled: z.boolean(),
    severity: z.enum(['score', 'block']),
  })
  .strict();

export const riskRulesConfigSchema = z.record(ruleIdSchema, ruleConfigSchema);

export type RuleConfig = z.infer<typeof ruleConfigSchema>;
export type RiskRulesConfig = z.infer<typeof riskRulesConfigSchema>;

/** Ham config'i dogrular; gecersizse hangi kuralin hangi alani oldugunu soyler. */
export function parseRiskRulesConfig(raw: unknown): RiskRulesConfig {
  const result = riskRulesConfigSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );
    throw new Error(`risk.rules.json gecersiz - ${problems.join('; ')}`);
  }
  return result.data;
}
