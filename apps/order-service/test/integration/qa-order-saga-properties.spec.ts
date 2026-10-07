/**
 * QA kara kutu (T15.2, order geriye donuk PR 1; OQ1): saga OZELLIK testi. Iki order kopyasi tek
 * Mongo'da, GERCEK payment (mock saglayici) ve inventory, ortak sahte saat (qa-order-cluster.ts).
 *
 * Sabit giris (PRELUDE) her yolu bir kez yurur: kart onay ve ret, 3DS dogru ve yanlis kod, hak
 * bitimi, orta bantta kapida odeme reddi, kapida odeme, inceleme, ret, taslakta ve odemede iptal,
 * kilidi dusen siparisin supurulmesi. Ardindan sabit tohumla rastgele adimlar: yeni siparis, kart,
 * kapida odeme, onay, iptal, supurucu, inventory supurucusu, saat, yayin, payment komutlari; her
 * adim rastgele kopyada. Degismezler her adimdan sonra ve kapanis turundan sonra
 * (qa-order-saga-invariants.ts). Kirmizida tohum ve adim izi yazdirilir; ayni tohum ayni plani
 * kosar: QA_ORDER_SEED=<tohum>.
 */

import { ORDER_STATUS, RISK_BANDS } from '@getir/core';
import { describe, expect, it } from 'vitest';

import {
  ATTEMPT_KIND,
  ATTEMPT_OUTCOME,
  PAYMENT_METHOD,
} from '../../../payment-service/src/domain/payment.js';
import { random, seedOf } from '../../../payment-service/test/support/qa-payment-model.js';
import { useOrderClusters } from '../support/qa-order-cluster.js';
import type { OrderCluster } from '../support/qa-order-cluster.js';
import { finalViolations, ordersOf, stepViolations } from '../support/qa-order-saga-invariants.js';
import { randomStep, SagaRun } from '../support/qa-order-saga-model.js';
import type { Step } from '../support/qa-order-saga-model.js';
import { PAST_LOCK_MS, useInventoryWorld } from '../support/qa-payment-world.js';

/** ~35 siparis, her taslak 2 adet kilitler: stok bitimi degismez ihlali gibi gorunmesin. */
const SAGA_ON_HAND = 1_000;
const world = useInventoryWorld('qa_order_saga', SAGA_ON_HAND);
const openCluster = useOrderClusters(world);

const DEFAULT_SEED = 0x0a5a0715;
const RANDOM_STEPS = 120;

/** Kapsam: her yol bir kez, tohumdan bagimsiz. Siparis numaralari giristeki siraya gore. */
const PRELUDE: readonly Step[] = [
  // o0 kart onay -> PAID; o1 kart ret -> PAYMENT_FAILED.
  { kind: 'new', copy: 0, band: RISK_BANDS.LOW },
  { kind: 'card', copy: 1, order: 0, card: 'APPROVED' },
  { kind: 'new', copy: 1, band: RISK_BANDS.LOW },
  { kind: 'card', copy: 0, order: 1, card: 'DECLINED' },
  // o2 3DS: yanlis kod (hak dusumu), dogru kod -> PAID.
  { kind: 'new', copy: 0, band: RISK_BANDS.LOW },
  { kind: 'card', copy: 1, order: 2, card: 'CHALLENGE' },
  { kind: 'confirm', copy: 0, order: 2, right: false },
  { kind: 'confirm', copy: 1, order: 2, right: true },
  // o3 orta bant: onayli kart da 3DS ister -> PAID; o4 orta bantta kapida odeme 422, DRAFT kalir.
  { kind: 'new', copy: 1, band: RISK_BANDS.MEDIUM },
  { kind: 'card', copy: 0, order: 3, card: 'APPROVED' },
  { kind: 'confirm', copy: 1, order: 3, right: true },
  { kind: 'new', copy: 0, band: RISK_BANDS.MEDIUM },
  { kind: 'cod', copy: 1, order: 4 },
  // o5 kapida odeme -> PAID; o6 yuksek bant -> REVIEW; o7 kritik -> REJECTED.
  { kind: 'new', copy: 1, band: RISK_BANDS.LOW },
  { kind: 'cod', copy: 0, order: 5 },
  { kind: 'new', copy: 0, band: RISK_BANDS.HIGH },
  { kind: 'card', copy: 1, order: 6, card: 'APPROVED' },
  { kind: 'new', copy: 1, band: RISK_BANDS.CRITICAL },
  { kind: 'card', copy: 0, order: 7, card: 'APPROVED' },
  // o8 taslakta iptal; o9 3DS beklerken iptal (payment komutu).
  { kind: 'new', copy: 0, band: RISK_BANDS.LOW },
  { kind: 'cancel', copy: 1, order: 8 },
  { kind: 'new', copy: 1, band: RISK_BANDS.LOW },
  { kind: 'card', copy: 0, order: 9, card: 'CHALLENGE' },
  { kind: 'cancel', copy: 1, order: 9 },
  // o10 uc yanlis kod -> PAYMENT_FAILED.
  { kind: 'new', copy: 0, band: RISK_BANDS.LOW },
  { kind: 'card', copy: 1, order: 10, card: 'CHALLENGE' },
  { kind: 'confirm', copy: 0, order: 10, right: false },
  { kind: 'confirm', copy: 1, order: 10, right: false },
  { kind: 'confirm', copy: 0, order: 10, right: false },
  // o11 taslak, o12 3DS bekler; kilit duser: supurucu ikisini de kapatir.
  { kind: 'new', copy: 1, band: RISK_BANDS.LOW },
  { kind: 'new', copy: 0, band: RISK_BANDS.LOW },
  { kind: 'card', copy: 1, order: 12, card: 'CHALLENGE' },
  { kind: 'advance', ms: PAST_LOCK_MS },
  { kind: 'inventory-sweep' },
  { kind: 'sweep', copy: 0 },
  { kind: 'relay', copy: 1 },
  { kind: 'deliver' },
];

/**
 * Kapanis: kilitler duser; iki kopyanin supurucusu ve yayincisi; komutlar payment'a. Iki tur.
 * inventory'nin supurucusu KOSMAZ: acik kalan kilidi o silerse L1 ("hicbir kilit acik kalmaz")
 * bir sey olcmez; kilitleri order'in supurucusu kapatmali.
 */
const SETTLE: readonly Step[] = [
  { kind: 'advance', ms: PAST_LOCK_MS },
  ...[0, 1].flatMap((round): Step[] => [
    { kind: 'sweep', copy: round },
    { kind: 'sweep', copy: 1 - round },
    { kind: 'relay', copy: round },
    { kind: 'relay', copy: 1 - round },
    { kind: 'deliver' },
  ]),
];

/** Giristen sonra gorulmesi gereken gecisler ve odeme yollari (kapsam tohumdan bagimsiz). */
const REQUIRED_COVERAGE = [
  'DRAFT>RISK_CHECK',
  'RISK_CHECK>RESERVED',
  'RESERVED>AWAITING_PAYMENT',
  'AWAITING_PAYMENT>PAID',
  'AWAITING_PAYMENT>PAYMENT_FAILED',
  'AWAITING_PAYMENT>CANCELLED',
  'DRAFT>CANCELLED',
  'RISK_CHECK>REVIEW',
  'RISK_CHECK>REJECTED',
  'PAID:kart',
  'PAID:3DS',
  'PAID:kapida',
  'ERR PAYMENT_METHOD_NOT_ALLOWED',
  'ERR PAYMENT_DECLINED',
  'ERR THREEDS_FAILED',
] as const;

function report(seed: number, run: SagaRun): string {
  const hex = `0x${seed.toString(16)}`;
  return [
    `tohum ${hex} (tekrar: QA_ORDER_SEED=${hex}); ${String(run.trace.length)} adim:`,
    ...run.trace,
  ].join('\n');
}

/** Siparislerin zaman cizelgesi gecisleri, PAID'in odeme yolu ve izdeki hata kodlari. */
async function coverageOf(cluster: OrderCluster, run: SagaRun): Promise<Set<string>> {
  const seen = new Set<string>();
  const ignored: string[] = [];
  const orders = await ordersOf(cluster, idsOf(run), ignored);
  for (const order of orders) {
    order.timeline.forEach((entry, index) => {
      const previous = order.timeline[index - 1];
      if (previous !== undefined) seen.add(`${previous.status}>${entry.status}`);
    });
    if (order.status !== ORDER_STATUS.PAID) continue;
    const payment = await cluster.payments.findByOrderId(order.id);
    const threeDs = (payment?.attempts ?? []).some(
      (attempt) =>
        attempt.kind === ATTEMPT_KIND.THREEDS && attempt.outcome === ATTEMPT_OUTCOME.CODE_ACCEPTED,
    );
    seen.add(
      payment?.method === PAYMENT_METHOD.CASH_ON_DELIVERY
        ? 'PAID:kapida'
        : threeDs
          ? 'PAID:3DS'
          : 'PAID:kart',
    );
  }
  for (const line of run.trace) {
    const error = /-> (ERR [A-Z_]+)/.exec(line)?.[1];
    if (error !== undefined) seen.add(error);
  }
  return seen;
}

function idsOf(run: SagaRun): string[] {
  return run.tracked.map((order) => order.orderId);
}

describe('QA OQ1 saga ozellikleri (iki order kopyasi, sabit tohum, gercek payment ve inventory)', () => {
  it(`giris + ${String(RANDOM_STEPS)} rastgele adim: degismezler her adimda ve kapanista`, async () => {
    const seed = seedOf(process.env['QA_ORDER_SEED'], 'QA_ORDER_SEED', DEFAULT_SEED);
    const cluster = await openCluster();
    const run = new SagaRun({
      cluster,
      clock: world.clock,
      sweepInventory: () => world.sweepInventory(),
    });
    const next = random(seed);
    // Ayni ihlal her adimda tekrar etmesin: ilk goruldugu adimla bir kez.
    const violations = new Map<string, string>();
    const step = async (planned: Step) => {
      await run.apply(planned);
      for (const violation of await stepViolations(world, cluster, idsOf(run))) {
        if (!violations.has(violation)) violations.set(violation, run.trace.at(-1) ?? '');
      }
    };

    for (const planned of PRELUDE) await step(planned);
    for (let index = 0; index < RANDOM_STEPS; index += 1) {
      await step(randomStep(next, run.tracked));
    }
    for (const planned of SETTLE) await step(planned);

    const found = [
      ...[...violations].map(([violation, at]) => `${violation} (ilk: ${at})`),
      ...(await finalViolations(world, cluster, idsOf(run))),
      ...run.unexpected.map((line) => `U beklenmeyen hata: ${line}`),
    ];
    expect(found, report(seed, run)).toEqual([]);
    const coverage = await coverageOf(cluster, run);
    expect(
      REQUIRED_COVERAGE.filter((required) => !coverage.has(required)),
      report(seed, run),
    ).toEqual([]);
  });
});
