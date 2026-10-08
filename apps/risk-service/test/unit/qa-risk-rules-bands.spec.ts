/**
 * QA kara kutu (T15.2, risk geriye donuk PR 2; RQ1): kural sinirlari ve bantlar, GERCEK risk gRPC'si
 * (buildRiskService: uretimin kurallari ve risk.rules.json agirliklari), sabit saat. Baglam domain
 * nesnesi olarak kurulur ve telden gider (proto-context.ts).
 *
 *   K1 her kuralin IKI yani: hesap yasi tam 24 sa, iptal orani tam %50 ve hemen ustu (%50,02), sepet
 *      tam 3 kat ve 1 kurus ustu, dwell tam 3000 ms ve 2999, cihazda 2 ve 3 hesap. Geofence 49,93 ve
 *      50,09 km (tam 50 km koordinatla kayan noktada temsil edilemez).
 *   K2 alti puan kuralinin 64 kombinasyonu TAM taranir: puan = tetiklenenlerin agirlik toplami (100
 *      tavan), bant testin kendi esikleriyle (T6.1: 30 MEDIUM, 55 HIGH, 80 CRITICAL). Bugunku
 *      agirliklarla uc esige de TAM ulasilir; esiklerin alt komsulari (29, 54, 79) ulasilamaz
 *      (bant fonksiyonunun kendisi bands.spec.ts'te).
 *   K3 veto: cihazda 3+ hesap puan ne olursa olsun CRITICAL; puan veto yuzunden degismez.
 *   K4 gerekce ve kayit kisisel veri tasimaz: IP, cihaz kimligi, konum ve koordinatlar gerekcede ve
 *      (bellek) kayitta yok; gerekceler bos degil. Mongo belgesi RQ2'de.
 *   K5 MEVCUT tel anlami: gRPC'de "teslim sayisi bilinmiyor" hali yok; gecmis gondermeyen
 *      cagiran 0 gonderir ve order-history ("hic teslim yok") tetiklenir. dwell 0 "olculmedi".
 */

import { fixedClock } from '@getir/core';
import { riskV1 } from '@getir/proto';
import { startTestGrpcServer } from '@getir/service-kit/testing';
import type { TestGrpcServer } from '@getir/service-kit/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PendingRecords } from '../../src/application/pending-records.js';
import { buildRiskService } from '../../src/bootstrap.js';
import { riskRulesConfig } from '../../src/config/risk-rules.js';
import type { RiskContext } from '../../src/domain/risk-context.js';
import { InMemoryRiskEventStore } from '../../src/infrastructure/memory/in-memory-risk-event-store.js';
import { evaluate as evaluateOn, fired } from '../support/qa-risk-calls.js';

const NOW = Date.parse('2026-10-07T12:00:00.000Z');
const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
/** Haversine (R = 6371 km): enlemde 1 derece ~ 111,195 km; 50 km ~ 0,4497 derece. */
const DELIVERY = { lat: 40.99, lng: 29.02 };
const NEAR = { lat: DELIVERY.lat + 0.449, lng: DELIVERY.lng };
const FAR = { lat: DELIVERY.lat + 0.4505, lng: DELIVERY.lng };
const IP = '203.0.113.7';
const OTHER_IP = '198.51.100.9';
const DEVICE = 'dev_qa_kisisel_cihaz';
/** Testin kendi bant esikleri (T6.1 karari); uretimin sabitine yaslanmaz. */
const THRESHOLDS = [
  [80, riskV1.RiskBand.RISK_BAND_CRITICAL],
  [55, riskV1.RiskBand.RISK_BAND_HIGH],
  [30, riskV1.RiskBand.RISK_BAND_MEDIUM],
] as const;

const SCORE_RULES = [
  'account-age',
  'order-history',
  'basket-anomaly',
  'checkout-dwell',
  'geofence',
  'ip-device',
] as const;
type ScoreRule = (typeof SCORE_RULES)[number];

const events = new InMemoryRiskEventStore();
let server: TestGrpcServer | undefined;
let orders = 0;

beforeAll(async () => {
  server = await startTestGrpcServer({
    serviceName: 'qa-risk-kurallar',
    services: [
      buildRiskService({ events, clock: fixedClock(NOW), pendingRecords: new PendingRecords() }),
    ],
  });
});

afterAll(async () => {
  await server?.stop();
});

/** Hicbir kurali tetiklemeyen baglam: eski hesap, temiz gecmis, olagan sepet, yavas, ayni yer/cihaz. */
function cleanContext(): RiskContext {
  orders += 1;
  const serial = String(orders).padStart(4, '0');
  return {
    userId: `usr_${'7'.repeat(28)}${serial}`,
    orderId: `ord_${'7'.repeat(28)}${serial}`,
    marketId: 'mkt_migros-jet-moda',
    accountCreatedAt: new Date(NOW - 30 * DAY_MS),
    deliveredOrderCount: 10,
    cancelledOrderCount: 0,
    basketTotalMinor: 10_000,
    userAverageBasketMinor: 10_000,
    checkoutDwellMs: 10_000,
    deliveryLocation: DELIVERY,
    sessionLocation: DELIVERY,
    ipAddress: IP,
    previousIpAddress: IP,
    deviceId: DEVICE,
    accountsOnDevice: 1,
  };
}

/** Kurali tetikleyen degisiklik (sinirin acikca otesinde). */
const TRIGGER: Readonly<Record<ScoreRule, Partial<RiskContext>>> = {
  'account-age': { accountCreatedAt: new Date(NOW - HOUR_MS) },
  'order-history': { deliveredOrderCount: 1, cancelledOrderCount: 2 },
  'basket-anomaly': { basketTotalMinor: 40_000 },
  'checkout-dwell': { checkoutDwellMs: 1_000 },
  geofence: { sessionLocation: FAR },
  'ip-device': { ipAddress: OTHER_IP },
};

const withAll = (base: RiskContext): RiskContext =>
  SCORE_RULES.reduce((built, rule) => ({ ...built, ...TRIGGER[rule] }), base);

async function evaluate(context: RiskContext): Promise<riskV1.RiskEvaluation> {
  if (server === undefined) throw new Error('risk sunucusu yok');
  return evaluateOn(server, context);
}

const firesFor = async (change: Partial<RiskContext>) =>
  fired(await evaluate({ ...cleanContext(), ...change }));

function expectedBand(score: number): riskV1.RiskBand {
  return THRESHOLDS.find(([bound]) => score >= bound)?.[1] ?? riskV1.RiskBand.RISK_BAND_LOW;
}

const weightOf = (rule: ScoreRule): number => riskRulesConfig[rule]?.weight ?? Number.NaN;

describe('QA RQ1 risk kurallari ve bantlar (gercek gRPC, gercek agirliklar)', () => {
  it('K1 her kuralin iki yani: sinirda tetiklemez, sinirin bir otesinde tetikler', async () => {
    const boundaries: readonly [string, Partial<RiskContext>, readonly string[]][] = [
      ['hesap tam 24 sa', { accountCreatedAt: new Date(NOW - DAY_MS) }, []],
      ['hesap 24 sa - 1 ms', { accountCreatedAt: new Date(NOW - DAY_MS + 1) }, ['account-age']],
      ['iptal orani tam %50', { deliveredOrderCount: 1, cancelledOrderCount: 1 }, []],
      [
        'iptal orani %50,02',
        { deliveredOrderCount: 1_000, cancelledOrderCount: 1_001 },
        ['order-history'],
      ],
      ['sepet tam 3 kat', { basketTotalMinor: 30_000 }, []],
      ['sepet 3 kat + 1 kurus', { basketTotalMinor: 30_001 }, ['basket-anomaly']],
      ['dwell tam 3000 ms', { checkoutDwellMs: 3_000 }, []],
      ['dwell 2999 ms', { checkoutDwellMs: 2_999 }, ['checkout-dwell']],
      ['oturum 49,93 km', { sessionLocation: NEAR }, []],
      ['oturum 50,09 km', { sessionLocation: FAR }, ['geofence']],
      ['cihazda 2 hesap', { accountsOnDevice: 2 }, []],
      ['cihazda 3 hesap', { accountsOnDevice: 3 }, ['ip-device']],
    ];
    const seen = [];
    for (const [label, change] of boundaries) seen.push([label, await firesFor(change)]);
    expect(seen).toEqual(boundaries.map(([label, , rules]) => [label, [...rules]]));
  });

  it('K2 alti puan kuralinin 64 kombinasyonu: puan agirliklar toplami, bant esiklerden', async () => {
    const reached = new Set<number>();
    const mismatches: string[] = [];
    for (let mask = 0; mask < 2 ** SCORE_RULES.length; mask += 1) {
      const chosen = SCORE_RULES.filter((_, index) => (mask & (1 << index)) !== 0);
      const context = chosen.reduce<RiskContext>(
        (built, rule) => ({ ...built, ...TRIGGER[rule] }),
        cleanContext(),
      );
      const evaluation = await evaluate(context);
      const score = Math.min(
        100,
        chosen.reduce((sum, rule) => sum + weightOf(rule), 0),
      );
      reached.add(score);
      const got = `${String(evaluation.score)} ${String(evaluation.band)} [${fired(evaluation).join(',')}] veto:${evaluation.vetoedByRuleId}`;
      const want = `${String(score)} ${String(expectedBand(score))} [${[...chosen].sort().join(',')}] veto:`;
      if (got !== want) mismatches.push(`${chosen.join('+') || 'hicbiri'}: ${got} != ${want}`);
    }
    expect(mismatches).toEqual([]);
    // Bugunku agirliklarla her esige TAM ulasan bir kombinasyon var: sinirin kendisi sinandi.
    // Agirliklar degisirse bu satir esige ulasan kombinasyon kalmadigini soyler (tablo yine gecerli).
    expect(
      [30, 55, 80].filter((bound) => !reached.has(bound)),
      `esige tam ulasan kombinasyon yok; ulasilan puanlar: ${[...reached].sort((a, b) => a - b).join(',')}`,
    ).toEqual([]);
  });

  it('K3 veto: cihazda 3+ hesap CRITICAL; puan veto yuzunden degismez (temiz ve butun kurallar)', async () => {
    const cases: readonly [RiskContext, number][] = [
      [cleanContext(), weightOf('ip-device')],
      [withAll(cleanContext()), 100],
    ];
    for (const [context, score] of cases) {
      const evaluation = await evaluate({ ...context, accountsOnDevice: 3 });
      expect([evaluation.band, evaluation.vetoedByRuleId, evaluation.score]).toEqual([
        riskV1.RiskBand.RISK_BAND_CRITICAL,
        'ip-device',
        score,
      ]);
    }
  });

  it('K4 gerekce ve kayit kisisel veri tasimaz: IP, cihaz, konum ve koordinat yok; gerekceler dolu', async () => {
    const context = { ...withAll(cleanContext()), accountsOnDevice: 4 };
    const evaluation = await evaluate(context);
    const stored = await events.findLatest({
      userId: context.userId,
      orderId: context.orderId ?? '',
    });

    expect(evaluation.hits.length).toBe(SCORE_RULES.length);
    expect(evaluation.hits.every((hit) => hit.reason.trim() !== '')).toBe(true);
    expect(stored?.hits.length).toBe(SCORE_RULES.length);
    const text = JSON.stringify([evaluation.hits, stored]);
    const coordinates = [DELIVERY.lat, DELIVERY.lng, FAR.lat, FAR.lng].flatMap((value) => [
      String(value),
      value.toFixed(2),
    ]);
    for (const secret of [IP, OTHER_IP, DEVICE, ...coordinates]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it('K5 MEVCUT tel anlami: teslim sayisi gonderilmezse 0 sayilir (order-history tetik); dwell 0 olculmedi', async () => {
    const {
      deliveredOrderCount: _delivered,
      cancelledOrderCount: _cancelled,
      ...noHistory
    } = cleanContext();
    expect(fired(await evaluate(noHistory))).toEqual(['order-history']);
    const { checkoutDwellMs: _dwell, ...noDwell } = cleanContext();
    expect(fired(await evaluate(noDwell))).toEqual([]);
  });
});
