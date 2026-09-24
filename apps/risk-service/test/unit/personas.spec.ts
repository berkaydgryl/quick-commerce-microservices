/**
 * Persona tablosu GERCEK motordan gecer: gercek alti kural, gercek config,
 * gercek esikler. Bir agirlik, esik ya da kural degisip bir persona bandindan
 * kayarsa bu test kirmizi olur (roadmap "Test personalari").
 */

import { fixedClock } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { createEvaluateRisk } from '../../src/application/evaluate-risk.js';
import { RULE_TIMEOUT_MS } from '../../src/config/constants.js';
import { riskRulesConfig } from '../../src/config/risk-rules.js';
import { createCoreRules } from '../../src/rules/index.js';
import { createRuleRegistry } from '../../src/rules/registry.js';
import { PERSONA_NOW, PERSONAS } from '../support/personas.js';

const clock = fixedClock(PERSONA_NOW);
const registry = createRuleRegistry(createCoreRules(clock), riskRulesConfig);
const evaluate = createEvaluateRisk({ rules: registry, clock, ruleTimeoutMs: RULE_TIMEOUT_MS });

describe('gercek kural kaydi', () => {
  it('alti cekirdek kural config ile iki yonlu eslesir ve hepsi acik', () => {
    expect(registry.map((entry) => entry.rule.id)).toEqual([
      'account-age',
      'order-history',
      'basket-anomaly',
      'checkout-dwell',
      'geofence',
      'ip-device',
    ]);
  });
});

describe('test personalari', () => {
  it.each(PERSONAS.map((persona) => [persona.name, persona] as const))('%s', async (_, persona) => {
    const evaluation = await evaluate(persona.context);

    expect({
      score: evaluation.score,
      band: evaluation.band,
      vetoedByRuleId: evaluation.vetoedByRuleId,
      hits: evaluation.hits.filter((hit) => hit.hit).map((hit) => hit.ruleId),
    }).toEqual({ vetoedByRuleId: undefined, ...persona.expected });
  });

  it('her persona butun kurallari listede tasir (tetiklenmeyen de)', async () => {
    for (const persona of PERSONAS) {
      expect((await evaluate(persona.context)).hits).toHaveLength(6);
    }
  });
});
