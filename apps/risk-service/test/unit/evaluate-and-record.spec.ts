/**
 * Evaluate + kayit: karar kaydedilir; kayit yazilamazsa karar YINE doner ve
 * error gunlugu yazilir (T6.3 karari); kayitta ham baglam (kisisel veri) yok.
 */

import { fixedClock, RISK_BANDS } from '@getir/core';
import type { Logger } from '@getir/core';
import { describe, expect, it, vi } from 'vitest';

import { createEvaluateAndRecord } from '../../src/application/evaluate-and-record.js';
import { createEvaluateRisk } from '../../src/application/evaluate-risk.js';
import { RULE_TIMEOUT_MS } from '../../src/config/constants.js';
import { riskRulesConfig } from '../../src/config/risk-rules.js';
import type { RiskEventRepository } from '../../src/domain/risk-event-repository.js';
import { InMemoryRiskEventStore } from '../../src/infrastructure/memory/in-memory-risk-event-store.js';
import { createCoreRules } from '../../src/rules/index.js';
import { createRuleRegistry } from '../../src/rules/registry.js';
import { PERSONA_NOW, PERSONAS } from '../support/personas.js';

const clock = fixedClock(PERSONA_NOW);
const evaluateRisk = createEvaluateRisk({
  rules: createRuleRegistry(createCoreRules(clock), riskRulesConfig),
  clock,
  ruleTimeoutMs: RULE_TIMEOUT_MS,
});
const ali = PERSONAS.find((persona) => persona.name.startsWith('Ali'));
if (ali === undefined) throw new Error('Ali personasi yok');

function fakeLogger(): { logger: Logger; error: ReturnType<typeof vi.fn> } {
  const error = vi.fn();
  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error,
    fatal: vi.fn(),
    child: () => logger,
  };
  return { logger, error };
}

describe('EvaluateAndRecord', () => {
  it('karari kaydeder: skor, bant, veto ve alti kuralin sonucu', async () => {
    const events = new InMemoryRiskEventStore();
    const evaluate = createEvaluateAndRecord({ evaluateRisk, events });

    const evaluation = await evaluate({ ...ali.context, orderId: 'ord_ali' });

    const recorded = await events.findLatest({ userId: ali.context.userId, orderId: 'ord_ali' });
    expect(recorded).toMatchObject({
      score: evaluation.score,
      band: RISK_BANDS.CRITICAL,
      vetoedByRuleId: 'ip-device',
      evaluatedAt: evaluation.evaluatedAt,
    });
    expect(recorded?.hits).toHaveLength(6);
    expect(recorded?.id).toMatch(/^rev_[0-9a-f]{32}$/);
  });

  it('kayitta ham baglam YOK: IP, cihaz kimligi, koordinat', async () => {
    const events = new InMemoryRiskEventStore();
    await createEvaluateAndRecord({ evaluateRisk, events })({
      ...ali.context,
      deviceId: 'dev_gizli',
      ipAddress: '85.105.1.2',
    });

    const serialized = JSON.stringify(await events.findLatest({ userId: ali.context.userId }));
    expect(serialized).not.toMatch(/85\.105|dev_gizli|38\.42|27\.14|40\.98/);
  });

  it('kayit yazilamazsa karar YINE doner ve error gunlugu yazilir', async () => {
    const { logger, error } = fakeLogger();
    const broken: RiskEventRepository = {
      insert: () => Promise.reject(new Error('mongo yok')),
      findLatest: () => Promise.resolve(null),
    };

    const evaluation = await createEvaluateAndRecord({ evaluateRisk, events: broken, logger })(
      ali.context,
    );

    expect(evaluation.band).toBe(RISK_BANDS.CRITICAL);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ali.context.userId, band: RISK_BANDS.CRITICAL }),
      expect.stringContaining('kaydedilemedi'),
    );
  });
});
