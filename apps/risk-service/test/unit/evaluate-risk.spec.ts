/**
 * EvaluateRisk: paralel kosu, hata ve zaman asimi izolasyonu, veto yetkisi.
 * Saat sabit; zaman asimi sahte zamanlayicilarla (belirlenebilir).
 */

import { fixedClock, RISK_BANDS } from '@getir/core';
import type { Logger } from '@getir/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEvaluateRisk } from '../../src/application/evaluate-risk.js';
import type { Rule, RuleOutcome, RuleSeverity } from '../../src/domain/rule.js';
import type { RegisteredRule } from '../../src/rules/registry.js';

const NOW = Date.UTC(2026, 8, 24, 10, 0, 0);
const TIMEOUT_MS = 200;
const context = { userId: 'usr_1' };

const entry = (
  id: string,
  weight: number,
  evaluate: Rule['evaluate'],
  severity: RuleSeverity = 'score',
): RegisteredRule => ({ rule: { id, evaluate }, weight, severity });

const returns =
  (outcome: RuleOutcome): Rule['evaluate'] =>
  () =>
    Promise.resolve(outcome);

/** Sahte gunlukcu; uyari sahtesi ayri dondurulur (metot koparilmaz). */
function fakeLogger(): { logger: Logger; warn: ReturnType<typeof vi.fn> } {
  const warn = vi.fn();
  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn,
    error: vi.fn(),
    fatal: vi.fn(),
    child: () => logger,
  };
  return { logger, warn };
}

function build(rules: RegisteredRule[], logger?: Logger) {
  return createEvaluateRisk({
    rules,
    clock: fixedClock(NOW),
    ruleTimeoutMs: TIMEOUT_MS,
    ...(logger === undefined ? {} : { logger }),
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('EvaluateRisk', () => {
  it('tum kurallar kosar; sonuc sirasi kayit sirasidir, zaman saatten gelir', async () => {
    const evaluate = build([
      entry('account-age', 20, returns({ hit: true, reason: 'hesap 4 saatlik' })),
      entry('order-history', 15, returns({ hit: true, reason: 'teslimat yok' })),
      entry('geofence', 15, returns({ hit: false, reason: 'ayni sehir' })),
    ]);

    const evaluation = await evaluate(context);

    expect(evaluation.score).toBe(35);
    expect(evaluation.band).toBe(RISK_BANDS.MEDIUM);
    expect(evaluation.hits.map((hit) => [hit.ruleId, hit.score])).toEqual([
      ['account-age', 20],
      ['order-history', 15],
      ['geofence', 0],
    ]);
    expect(evaluation.evaluatedAt).toEqual(new Date(NOW));
  });

  it('kurallar PARALEL kosar: biri beklerken digeri baslamistir', async () => {
    const started: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: Rule['evaluate'] = async () => {
      started.push('slow');
      await gate;
      return { hit: false, reason: 'yavas' };
    };
    const fast: Rule['evaluate'] = () => {
      started.push('fast');
      release();
      return Promise.resolve({ hit: false, reason: 'hizli' });
    };

    await build([entry('slow', 10, slow), entry('fast', 10, fast)])(context);

    expect(started).toEqual(['slow', 'fast']);
  });

  it('hata veren kural 0 puan + uyari; digerleri etkilenmez', async () => {
    const { logger, warn } = fakeLogger();
    const evaluate = build(
      [
        entry('account-age', 20, returns({ hit: true, reason: 'yeni' })),
        entry('geofence', 15, () => Promise.reject(new Error('konum servisi yok'))),
      ],
      logger,
    );

    const evaluation = await evaluate(context);

    expect(evaluation.score).toBe(20);
    expect(evaluation.hits[1]).toMatchObject({
      ruleId: 'geofence',
      hit: false,
      score: 0,
      reason: 'kural hatasi',
    });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ ruleId: 'geofence' }),
      expect.stringContaining('hata'),
    );
  });

  it('senkron firlatan kural da ayni sekilde izole edilir', async () => {
    const throwing: Rule['evaluate'] = () => {
      throw new Error('senkron');
    };
    const evaluation = await build([entry('bad', 50, throwing)])(context);
    expect(evaluation).toMatchObject({ score: 0, band: RISK_BANDS.LOW });
  });

  it('takilan kural sure siniri sonunda 0 puan sayilir, degerlendirme biter', async () => {
    vi.useFakeTimers();
    const { logger, warn } = fakeLogger();
    const never: Rule['evaluate'] = () => new Promise<RuleOutcome>(() => undefined);
    const evaluate = build(
      [entry('account-age', 20, returns({ hit: true, reason: 'yeni' })), entry('stuck', 50, never)],
      logger,
    );

    const pending = evaluate(context);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    const evaluation = await pending;

    expect(evaluation.score).toBe(20);
    expect(evaluation.hits[1]).toMatchObject({ ruleId: 'stuck', score: 0 });
    expect(warn).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('zamaninda biten kurallar zamanlayici birakmaz', async () => {
    vi.useFakeTimers();
    await build([entry('a', 10, returns({ hit: true, reason: 'x' }))])(context);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('severity "block" olan kural veto edebilir: skor 45, bant CRITICAL', async () => {
    const evaluation = await build([
      entry(
        'ip-device',
        15,
        returns({ hit: true, reason: 'cihazda 4 hesap', veto: true }),
        'block',
      ),
      entry('checkout-dwell', 15, returns({ hit: true, reason: '1.2 sn' })),
      entry('geofence', 15, returns({ hit: true, reason: 'farkli sehir' })),
    ])(context);

    expect(evaluation).toMatchObject({
      score: 45,
      band: RISK_BANDS.CRITICAL,
      vetoedByRuleId: 'ip-device',
    });
    expect(evaluation.hits[0]?.veto).toBe(true);
  });

  it('yetkisi olmayan kuralin veto istegi yok sayilir ve uyari yazilir', async () => {
    const { logger, warn } = fakeLogger();
    const evaluation = await build(
      [entry('geofence', 15, returns({ hit: true, reason: 'x', veto: true }), 'score')],
      logger,
    )(context);

    expect(evaluation).toMatchObject({ score: 15, band: RISK_BANDS.LOW });
    expect(evaluation.vetoedByRuleId).toBeUndefined();
    expect(evaluation.hits[0]?.veto).toBe(false);
    expect(warn).toHaveBeenCalledWith({ ruleId: 'geofence' }, expect.stringContaining('veto'));
  });
});
