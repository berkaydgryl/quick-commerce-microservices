/**
 * Yapiskan bant (#164): bant, kullanicinin son 15 dk'daki degerlendirmelerinin
 * SKORDAN gelen en yuksek bandinin altina inmez; skor degismez. Gecmisin skoruna
 * bakildigi icin yapiskanlik kendini uzatmaz (10 dk arayla uc sipariste ucuncude
 * duser). Okuma 150 ms'i asar ya da duserse yapiskanlik yok, WARN (fail-open, #167).
 * Motor betiklidir (kurallar degil yapiskanlik test edilir); kayit yolu gercektir.
 */

import { fixedClock, RISK_BANDS } from '@getir/core';
import type { RiskBand } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEvaluateAndRecord } from '../../src/application/evaluate-and-record.js';
import type { EvaluateRisk } from '../../src/application/evaluate-risk.js';
import { createEvaluateWithRecentBand } from '../../src/application/evaluate-with-recent-band.js';
import { createReadRecentBand } from '../../src/application/read-recent-band.js';
import { RECENT_BAND_READ_TIMEOUT_MS, RECENT_BAND_WINDOW_MS } from '../../src/config/constants.js';
import { bandForScore } from '../../src/domain/bands.js';
import {
  raiseToRecentBand,
  recentBandOf,
  RECENT_BAND_RULE_ID,
  scoredBandOf,
} from '../../src/domain/recent-band.js';
import type { RiskContext } from '../../src/domain/risk-context.js';
import type {
  RecentEventsQuery,
  RecentRiskEvents,
} from '../../src/domain/risk-event-repository.js';
import type { RiskEvent } from '../../src/domain/risk-event.js';
import { InMemoryRiskEventStore } from '../../src/infrastructure/memory/in-memory-risk-event-store.js';
import { PERSONA_NOW, PERSONAS } from '../support/personas.js';

const MINUTE = 60 * 1000;
const zeynep = PERSONAS.find((persona) => persona.name.startsWith('Zeynep'));
if (zeynep === undefined) throw new Error('Zeynep personasi yok');
const context: RiskContext = zeynep.context;

function event(score: number, at: number, extra: Partial<RiskEvent> = {}): RiskEvent {
  return {
    id: `rev_${String(at)}`,
    userId: context.userId,
    score,
    band: bandForScore(score),
    hits: [],
    evaluatedAt: new Date(at),
    ...extra,
  };
}

/** Sirayla verilen skorlari donduren motor (veto yok). */
function scriptedEngine(clock: { date(): Date }, scores: number[]): EvaluateRisk {
  return () => {
    const score = scores.shift() ?? 0;
    return Promise.resolve({
      score,
      band: bandForScore(score),
      hits: [],
      evaluatedAt: clock.date(),
    });
  };
}

function harness(scores: number[], events: InMemoryRiskEventStore = new InMemoryRiskEventStore()) {
  const clock = fixedClock(PERSONA_NOW);
  const lines: LogLine[] = [];
  const evaluateRisk = createEvaluateWithRecentBand({
    evaluateRisk: scriptedEngine(clock, scores),
    readRecentBand: createReadRecentBand({
      events,
      clock,
      windowMs: RECENT_BAND_WINDOW_MS,
      readTimeoutMs: RECENT_BAND_READ_TIMEOUT_MS,
    }),
  });
  const evaluate = createEvaluateAndRecord({ evaluateRisk, events });
  return { clock, lines, events, run: () => evaluate(context, recordingLogger(lines)) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('yapiskan bant: domain', () => {
  it('pencere 15 dk (karar: PM 08.10, kullaniciya not edildi); degisirse BILEREK degissin', () => {
    expect(RECENT_BAND_WINDOW_MS).toBe(15 * MINUTE);
  });

  it('gecmis kaydin bandi SKORDAN gelir (yukseltilmis bant degil); veto CRITICAL', () => {
    expect(scoredBandOf(event(20, PERSONA_NOW, { band: RISK_BANDS.MEDIUM }))).toBe(RISK_BANDS.LOW);
    expect(scoredBandOf(event(45, PERSONA_NOW, { vetoedByRuleId: 'ip-device' }))).toBe(
      RISK_BANDS.CRITICAL,
    );
  });

  it('en yuksek kayittan yakin bant: skordan bant, kaynak kimligi ve zamani; kayit yoksa null', () => {
    const source = event(35, PERSONA_NOW - 2 * MINUTE, { band: RISK_BANDS.HIGH });

    expect(recentBandOf(source)).toEqual({
      band: RISK_BANDS.MEDIUM,
      sourceEventId: source.id,
      sourceEvaluatedAt: source.evaluatedAt,
    });
    expect(recentBandOf(null)).toBeNull();
  });

  it('bant yukselir, dusmez; skor ve veto ayni kalir; puansiz recent-band isabeti eklenir', () => {
    const low = { score: 20, band: RISK_BANDS.LOW as RiskBand, hits: [] };
    const recent = {
      band: RISK_BANDS.MEDIUM as RiskBand,
      sourceEventId: 'rev_1',
      sourceEvaluatedAt: new Date(0),
    };

    const raised = raiseToRecentBand(low, recent);
    const notLowered = raiseToRecentBand({ ...low, band: RISK_BANDS.HIGH }, recent);

    expect(raised).toMatchObject({ score: 20, band: RISK_BANDS.MEDIUM });
    expect(raised.hits).toEqual([
      expect.objectContaining({ ruleId: RECENT_BAND_RULE_ID, hit: true, score: 0, veto: false }),
    ]);
    expect(notLowered.band).toBe(RISK_BANDS.HIGH);
    expect(notLowered.hits).toEqual([]);
  });
});

describe('yapiskan bant: degerlendirme ve kayit', () => {
  it('MEDIUM sonrasi hemen tekrar LOW skorla: bant MEDIUM kalir, kayitta isabet; gunlukte kaynak kimligi ve zamani', async () => {
    const h = harness([35, 20]);

    const first = await h.run();
    h.clock.advance(MINUTE);
    const retry = await h.run();

    expect(first.band).toBe(RISK_BANDS.MEDIUM);
    expect(retry).toMatchObject({ score: 20, band: RISK_BANDS.MEDIUM });
    expect(retry.hits.map((hit) => hit.ruleId)).toEqual([RECENT_BAND_RULE_ID]);
    const line = h.lines.find(
      (entry) => entry.message === 'risk bandi yakin degerlendirmeyle yukseltildi',
    );
    const source = await h.events.findHighestRecent({ userId: context.userId, since: new Date(0) });
    expect(line?.fields).toMatchObject({
      userId: context.userId,
      scoredBand: RISK_BANDS.LOW,
      band: RISK_BANDS.MEDIUM,
      sourceEventId: source?.id,
      sourceEvaluatedAt: new Date(PERSONA_NOW).toISOString(),
    });
    expect(JSON.stringify(h.lines)).not.toMatch(/ipAddress|deviceId|10\.0\.0\.1/);
  });

  it('pencere sinirda DAHIL (tam 15 dk), 1 ms sonra yapiskanlik biter', async () => {
    const atBoundary = harness([35, 20]);
    await atBoundary.run();
    atBoundary.clock.advance(RECENT_BAND_WINDOW_MS);
    const justInside = await atBoundary.run();

    const after = harness([35, 20]);
    await after.run();
    after.clock.advance(RECENT_BAND_WINDOW_MS + 1);
    const justOutside = await after.run();

    expect(justInside.band).toBe(RISK_BANDS.MEDIUM);
    expect(justOutside.band).toBe(RISK_BANDS.LOW);
  });

  it('kendini UZATMAZ: 10 dk arayla uc siparis (MEDIUM, LOW, LOW) -> ikinci MEDIUM, ucuncu LOW', async () => {
    const h = harness([35, 20, 20]);

    const first = await h.run();
    h.clock.advance(10 * MINUTE);
    const second = await h.run();
    h.clock.advance(10 * MINUTE);
    const third = await h.run();

    expect([first.band, second.band, third.band]).toEqual([
      RISK_BANDS.MEDIUM,
      RISK_BANDS.MEDIUM,
      RISK_BANDS.LOW,
    ]);
  });

  it('TAHLIYE YOK (#164 guvenlik): 1 MEDIUM + 25 LOW degerlendirme sonra yine MEDIUM', async () => {
    const h = harness([35, ...Array.from({ length: 26 }, () => 20)]);

    await h.run();
    let last = await h.run();
    for (let step = 1; step < 26; step += 1) {
      h.clock.advance(1_000);
      last = await h.run();
    }

    expect(last).toMatchObject({ score: 20, band: RISK_BANDS.MEDIUM });
  });

  it('TAHLIYE YOK: 1 HIGH + 25 MEDIUM degerlendirme sonra yine HIGH', async () => {
    const h = harness([60, ...Array.from({ length: 26 }, () => 35)]);

    await h.run();
    let last = await h.run();
    for (let step = 1; step < 26; step += 1) {
      h.clock.advance(1_000);
      last = await h.run();
    }

    expect(last).toMatchObject({ score: 35, band: RISK_BANDS.HIGH });
  });

  it('veto (CRITICAL) de yapisir; baska kullanicinin kaydi etkilemez', async () => {
    const events = new InMemoryRiskEventStore();
    await events.insert(event(45, PERSONA_NOW - MINUTE, { vetoedByRuleId: 'ip-device' }));
    await events.insert({
      ...event(80, PERSONA_NOW - MINUTE),
      id: 'rev_baska',
      userId: 'usr_baska',
    });
    const h = harness([0], events);

    const evaluation = await h.run();

    expect(evaluation).toMatchObject({ score: 0, band: RISK_BANDS.CRITICAL });
  });
});

describe('yapiskan bant: okuma siniri (fail-open, #167)', () => {
  function withStore(events: RecentRiskEvents) {
    const clock = fixedClock(PERSONA_NOW);
    const lines: LogLine[] = [];
    const evaluateRisk = createEvaluateWithRecentBand({
      evaluateRisk: scriptedEngine(clock, [20]),
      readRecentBand: createReadRecentBand({
        events,
        clock,
        windowMs: RECENT_BAND_WINDOW_MS,
        readTimeoutMs: RECENT_BAND_READ_TIMEOUT_MS,
      }),
    });
    return { lines, evaluate: () => evaluateRisk(context, recordingLogger(lines)) };
  }

  it('okuma 150 ms icinde bitmezse yapiskanlik yok, WARN; karar sinirda doner', async () => {
    vi.useFakeTimers();
    const hanging: RecentRiskEvents = { findHighestRecent: () => new Promise(() => undefined) };
    const { lines, evaluate } = withStore(hanging);

    const pending = evaluate();
    await vi.advanceTimersByTimeAsync(RECENT_BAND_READ_TIMEOUT_MS);
    const evaluation = await pending;

    expect(evaluation.band).toBe(RISK_BANDS.LOW);
    expect(
      lines.find((line) => line.message === 'yakin bant okunamadi, yapiskanlik uygulanmadi'),
    ).toMatchObject({ level: 'warn', fields: { userId: context.userId } });
  });

  it('surucuye de ayni sinir verilir (timeoutMs): baglanti beklemeden sonra tutulmasin', async () => {
    const queries: RecentEventsQuery[] = [];
    const recording: RecentRiskEvents = {
      findHighestRecent: (query) => {
        queries.push(query);
        return Promise.resolve(null);
      },
    };

    await withStore(recording).evaluate();

    expect(queries).toEqual([
      {
        userId: context.userId,
        since: new Date(PERSONA_NOW - RECENT_BAND_WINDOW_MS),
        timeoutMs: RECENT_BAND_READ_TIMEOUT_MS,
      },
    ]);
  });

  it('okuma hata verirse yapiskanlik yok, WARN; hata degerlendirmeyi dusurmez', async () => {
    const broken: RecentRiskEvents = {
      findHighestRecent: () => Promise.reject(new Error('mongo yok')),
    };
    const { lines, evaluate } = withStore(broken);

    const evaluation = await evaluate();

    expect(evaluation.band).toBe(RISK_BANDS.LOW);
    expect(lines.map((line) => line.message)).toContain(
      'yakin bant okunamadi, yapiskanlik uygulanmadi',
    );
  });
});
