/**
 * Evaluate + kayit: karar kaydedilir; kayit yazilamazsa karar YINE doner ve
 * error gunlugu yazilir (T6.3 karari); kayitta ham baglam (kisisel veri) yok.
 * Kayit sure sinirlidir (#167): Mongo takilirsa karar sinirda doner (WARN +
 * timed_out), kayit arka planda surer ve sonucu BIR KEZ bildirilir (late ya da
 * failed). Bildirim kanali bozuk olsa da karar doner, unhandledRejection yok.
 * Sure testleri sahte saatle (belirlenimci).
 */

import { fixedClock, RISK_BANDS, silentLogger } from '@getir/core';
import type { Logger } from '@getir/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createEvaluateAndRecord,
  RECORD_EVENT,
} from '../../src/application/evaluate-and-record.js';
import type { RecordEvent } from '../../src/application/evaluate-and-record.js';
import { createEvaluateRisk } from '../../src/application/evaluate-risk.js';
import { ABANDONED_REASON, PendingRecords } from '../../src/application/pending-records.js';
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
const found = PERSONAS.find((persona) => persona.name.startsWith('Ali'));
if (found === undefined) throw new Error('Ali personasi yok');
const ali = found;

const RECORD_TIMEOUT_MS = 200;

function fakeLogger() {
  const error = vi.fn();
  const warn = vi.fn();
  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn,
    error,
    fatal: vi.fn(),
    child: () => logger,
  };
  return { logger, error, warn };
}

/** Kaydi disaridan bitirilen depo: Mongo donmasi ve gec cevap. */
function pendingStore() {
  let settle: { resolve: () => void; reject: (error: Error) => void } = {
    resolve: () => undefined,
    reject: () => undefined,
  };
  const events: RiskEventRepository = {
    insert: () =>
      new Promise<void>((resolve, reject) => {
        settle = { resolve, reject };
      }),
    findLatest: () => Promise.resolve(null),
  };
  return { events, settle: () => settle };
}

function setup(events: RiskEventRepository, onRecordThrows = false) {
  const reported: RecordEvent[] = [];
  const pending = new PendingRecords();
  const log = fakeLogger();
  const evaluate = createEvaluateAndRecord({
    evaluateRisk,
    events,
    recordTimeoutMs: RECORD_TIMEOUT_MS,
    pending,
    onRecord: (event) => {
      reported.push(event);
      if (onRecordThrows) throw new Error('metrik kanali bozuk');
    },
  });
  return { evaluate, reported, pending, ...log };
}

describe('EvaluateAndRecord', () => {
  it('karari kaydeder: skor, bant, veto ve alti kuralin sonucu; sonuc recorded', async () => {
    const events = new InMemoryRiskEventStore();
    const { evaluate, reported } = setup(events);

    const evaluation = await evaluate({ ...ali.context, orderId: 'ord_ali' }, silentLogger);

    const recorded = await events.findLatest({ userId: ali.context.userId, orderId: 'ord_ali' });
    expect(recorded).toMatchObject({
      score: evaluation.score,
      band: RISK_BANDS.CRITICAL,
      vetoedByRuleId: 'ip-device',
      evaluatedAt: evaluation.evaluatedAt,
    });
    expect(recorded?.hits).toHaveLength(6);
    expect(recorded?.id).toMatch(/^rev_[0-9a-f]{32}$/);
    expect(reported).toEqual([RECORD_EVENT.RECORDED]);
  });

  it('kayitta ham baglam YOK: IP, cihaz kimligi, koordinat', async () => {
    const events = new InMemoryRiskEventStore();
    await setup(events).evaluate(
      { ...ali.context, deviceId: 'dev_gizli', ipAddress: '85.105.1.2' },
      silentLogger,
    );

    const serialized = JSON.stringify(await events.findLatest({ userId: ali.context.userId }));
    expect(serialized).not.toMatch(/85\.105|dev_gizli|38\.42|27\.14|40\.98/);
  });

  it('kayit yazilamazsa karar YINE doner ve error gunlugu yazilir (failed)', async () => {
    const { evaluate, reported, logger, error, warn } = setup({
      insert: () => Promise.reject(new Error('mongo yok')),
      findLatest: () => Promise.resolve(null),
    });

    // Gunlukcu CAGRININ gunlukcusudur (handler'da ctx.logger: requestId bagli).
    const evaluation = await evaluate(ali.context, logger);

    expect(evaluation.band).toBe(RISK_BANDS.CRITICAL);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ali.context.userId, band: RISK_BANDS.CRITICAL }),
      expect.stringContaining('kaydedilemedi'),
    );
    expect(warn).not.toHaveBeenCalled();
    expect(reported).toEqual([RECORD_EVENT.FAILED]);
  });

  it('kayit senkron firlatsa da karar doner (failed)', async () => {
    const { evaluate, reported, logger, error } = setup({
      insert: () => {
        throw new Error('esleme bozuk');
      },
      findLatest: () => Promise.resolve(null),
    });

    expect((await evaluate(ali.context, logger)).band).toBe(RISK_BANDS.CRITICAL);
    expect(error).toHaveBeenCalledTimes(1);
    expect(reported).toEqual([RECORD_EVENT.FAILED]);
  });

  it('bildirim kanali bozuk olsa da (metrik ve gunluk firlatir) karar doner; basarili kayit failed sayilmaz', async () => {
    const { evaluate, reported, logger, error } = setup(new InMemoryRiskEventStore(), true);
    error.mockImplementation(() => {
      throw new Error('gunluk bozuk');
    });

    expect((await evaluate(ali.context, logger)).band).toBe(RISK_BANDS.CRITICAL);
    expect(reported).toEqual([RECORD_EVENT.RECORDED]);
    expect(error).not.toHaveBeenCalled();

    const broken = setup(
      {
        insert: () => Promise.reject(new Error('mongo yok')),
        findLatest: () => Promise.resolve(null),
      },
      true,
    );
    broken.error.mockImplementation(() => {
      throw new Error('gunluk bozuk');
    });
    expect((await broken.evaluate(ali.context, broken.logger)).band).toBe(RISK_BANDS.CRITICAL);
  });

  it('metrik kanali bozuksa kayip YINE gunluge yazilir (metrik hatasi gunlugu atlatmaz)', async () => {
    const { evaluate, reported, logger, error } = setup(
      {
        insert: () => Promise.reject(new Error('mongo yok')),
        findLatest: () => Promise.resolve(null),
      },
      true,
    );

    expect((await evaluate(ali.context, logger)).band).toBe(RISK_BANDS.CRITICAL);
    expect(reported).toEqual([RECORD_EVENT.FAILED]);
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe('EvaluateAndRecord kayit sure siniri (#167, sahte saat)', () => {
  let unhandled: unknown[];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  beforeEach(() => {
    vi.useFakeTimers();
    unhandled = [];
    process.on('unhandledRejection', onUnhandled);
  });

  afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
    vi.useRealTimers();
  });

  /** Karari baslatir ve kayit siniri kadar saati ilerletir. */
  async function decideAtLimit(evaluate: ReturnType<typeof setup>['evaluate'], logger: Logger) {
    const decision = evaluate(ali.context, logger);
    await vi.advanceTimersByTimeAsync(RECORD_TIMEOUT_MS);
    return decision;
  }

  it('Mongo donarsa karar TAM SINIRDA doner (kayit beklenmez): WARN + timed_out; gec kayit yazilirsa late, hata yok', async () => {
    const store = pendingStore();
    const { evaluate, reported, pending, logger, warn, error } = setup(store.events);

    const decision = evaluate(ali.context, logger);
    await vi.advanceTimersByTimeAsync(RECORD_TIMEOUT_MS - 1);
    expect(reported).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);

    expect((await decision).band).toBe(RISK_BANDS.CRITICAL);
    expect(reported).toEqual([RECORD_EVENT.TIMED_OUT]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: ali.context.userId,
        band: RISK_BANDS.CRITICAL,
        timeoutMs: RECORD_TIMEOUT_MS,
      }),
      expect.stringContaining('sure sinirini asti'),
    );
    expect(pending.size).toBe(1);

    store.settle().resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(reported).toEqual([RECORD_EVENT.TIMED_OUT, RECORD_EVENT.LATE]);
    expect(error).not.toHaveBeenCalled();
    expect(pending.size).toBe(0);
  });

  it('sinirdan sonra kayit duserse: error + failed, BIR KEZ (nihai sonuc tek)', async () => {
    const store = pendingStore();
    const { evaluate, reported, logger, error } = setup(store.events);

    await decideAtLimit(evaluate, logger);
    store.settle().reject(new Error('islem siniri asildi'));
    await vi.advanceTimersByTimeAsync(0);

    expect(reported).toEqual([RECORD_EVENT.TIMED_OUT, RECORD_EVENT.FAILED]);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ali.context.userId }),
      expect.stringContaining('kaydedilemedi'),
    );
  });

  it('kapanista yarim kalan kayit failed + error, BIR KEZ; sonra soz dusse ya da bitse de tekrar sayilmaz', async () => {
    const store = pendingStore();
    const { evaluate, reported, pending, logger, error } = setup(store.events);
    await decideAtLimit(evaluate, logger);

    const drained = pending.drain(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await drained).toBe(1);
    expect(reported).toEqual([RECORD_EVENT.TIMED_OUT, RECORD_EVENT.FAILED]);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ err: new Error(ABANDONED_REASON) }),
      expect.any(String),
    );

    store.settle().reject(new Error('baglanti kapandi'));
    await vi.advanceTimersByTimeAsync(0);
    expect(reported).toEqual([RECORD_EVENT.TIMED_OUT, RECORD_EVENT.FAILED]);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('hicbir yolda unhandledRejection yok: hemen dusen, sinirdan sonra dusen, birakilan; bildirim firlatsa bile', async () => {
    const immediate = setup(
      { insert: () => Promise.reject(new Error('hemen')), findLatest: () => Promise.resolve(null) },
      true,
    );
    const late = pendingStore();
    const lateRun = setup(late.events, true);
    lateRun.error.mockImplementation(() => {
      throw new Error('gunluk bozuk');
    });
    const abandoned = pendingStore();
    const abandonedRun = setup(abandoned.events, true);

    await immediate.evaluate(ali.context, immediate.logger);
    await decideAtLimit(lateRun.evaluate, lateRun.logger);
    await decideAtLimit(abandonedRun.evaluate, abandonedRun.logger);
    late.settle().reject(new Error('sinirdan sonra'));
    await vi.advanceTimersByTimeAsync(0);
    const drained = abandonedRun.pending.drain(10);
    await vi.advanceTimersByTimeAsync(10);
    expect(await drained).toBe(1);
    abandoned.settle().reject(new Error('birakildiktan sonra'));
    await vi.advanceTimersByTimeAsync(0);

    expect(lateRun.reported).toEqual([RECORD_EVENT.TIMED_OUT, RECORD_EVENT.FAILED]);
    expect(unhandled).toEqual([]);
  });
});
