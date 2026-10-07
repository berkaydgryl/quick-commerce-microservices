/**
 * QA OQ1 (T15.2): saga ozellik testinin ADIMLARI. Iki order kopyasi (qa-order-cluster.ts),
 * GERCEK payment ve inventory, ortak sahte saat. Adimlar SIRAYLA kosar (yaris OQ2/OQ3'te).
 *
 * Belirlenimcilik: tohum ADIM PLANINI belirler. Her adim butun rastgele secimlerini adimi
 * uygulamadan (ilk await'ten) once yapar; onceki adimlarin sonucu (or. challengeId) yalnizca
 * hangi siparisin secilebilecegini daraltir ve o sonuc da sirali kosuda belirlenimcidir.
 * Kapsam tohuma bagli DEGIL: spec'teki sabit giris (PRELUDE) her yolu bir kez yurur.
 *
 * Her adim izde bir satir: `#<sira> k<kopya> <adim> -> <sonuc>`; kirmizida tohumla yazdirilir.
 */

import { ERROR_CODES, RISK_BANDS } from '@getir/core';
import type { MutableClock, RiskBand } from '@getir/core';
import { orderV1 } from '@getir/proto';
import { appErrorOf } from '@getir/service-kit/testing';
import type { CallResult } from '@getir/service-kit/testing';

import { TEST_CARD } from './fake-payments.js';
import { WRONG_CODE } from './qa-order-calls.js';
import type { OrderCluster } from './qa-order-cluster.js';

/** Testin izledigi siparis: kimlik, sahip, risk bandi, varsa 3DS dogrulamasi. */
export interface Tracked {
  readonly orderId: string;
  readonly userId: string;
  readonly band: RiskBand;
  challengeId?: string;
}

type Card = keyof typeof TEST_CARD;

export type Step =
  | { readonly kind: 'new'; readonly copy: number; readonly band: RiskBand }
  | { readonly kind: 'card'; readonly copy: number; readonly order: number; readonly card: Card }
  | { readonly kind: 'cod'; readonly copy: number; readonly order: number }
  | {
      readonly kind: 'confirm';
      readonly copy: number;
      readonly order: number;
      readonly right: boolean;
    }
  | { readonly kind: 'cancel'; readonly copy: number; readonly order: number }
  | { readonly kind: 'sweep'; readonly copy: number }
  | { readonly kind: 'inventory-sweep' }
  | { readonly kind: 'advance'; readonly ms: number }
  | { readonly kind: 'relay'; readonly copy: number }
  | { readonly kind: 'deliver' };

/** Uygulama hatasi tasimayan gRPC hatasi (tasima hatasi, sure asimi, eslenmemis cokme). */
const NOT_APP_ERROR = 'UNKNOWN';

/**
 * Beklenmeyen hata: servis ici hata, uygulama hatasi tasimayan hata ya da (ariza yokken)
 * ulasilamama. Degismez ihlali sayilir.
 */
const UNEXPECTED: ReadonlySet<string> = new Set([
  NOT_APP_ERROR,
  ERROR_CODES.INTERNAL,
  ERROR_CODES.SERVICE_UNAVAILABLE,
  ERROR_CODES.NOT_IMPLEMENTED,
]);

export interface SagaWorld {
  readonly cluster: OrderCluster;
  readonly clock: MutableClock;
  sweepInventory(): Promise<void>;
}

export class SagaRun {
  readonly tracked: Tracked[] = [];
  readonly trace: string[] = [];
  /** Beklenmeyen hatalar (izdeki satirla). */
  readonly unexpected: string[] = [];
  private delivered = 0;

  constructor(private readonly world: SagaWorld) {}

  /** Adimi uygular ve ize yazar. */
  async apply(step: Step): Promise<void> {
    const label = `#${String(this.trace.length + 1)} ${describeStep(step, this.tracked)}`;
    // Firlayan adim (or. taslak acilamadi) de ize yazilir ve beklenmeyen sayilir; kosu surer.
    const result = await this.run(step).catch(
      (error: unknown) => `ERR ${ERROR_CODES.INTERNAL} (firladi: ${String(error)})`,
    );
    const line = `${label} -> ${result}`;
    this.trace.push(line);
    const code = result.startsWith('ERR ') ? result.slice(4).split(' ')[0] : undefined;
    if (code !== undefined && UNEXPECTED.has(code)) this.unexpected.push(line);
  }

  private async run(step: Step): Promise<string> {
    const { cluster } = this.world;
    switch (step.kind) {
      case 'new': {
        const userId = cluster.nextUser();
        cluster.risk.bands.set(userId, step.band);
        const orderId = await cluster.copy(step.copy).calls.draft(userId);
        this.tracked.push({ orderId, userId, band: step.band });
        return `o${String(this.tracked.length - 1)}`;
      }
      case 'card': {
        const order = this.order(step.order);
        const result = await cluster
          .copy(step.copy)
          .calls.createOrder(order.orderId, order.userId, TEST_CARD[step.card]);
        if (result.response?.challengeId) order.challengeId = result.response.challengeId;
        return outcomeOf(result);
      }
      case 'cod': {
        const order = this.order(step.order);
        return outcomeOf(
          await cluster.copy(step.copy).calls.payOnDelivery(order.orderId, order.userId),
        );
      }
      case 'confirm': {
        const order = this.order(step.order);
        const code = step.right ? undefined : WRONG_CODE;
        const result = await cluster
          .copy(step.copy)
          .calls.confirm(order.orderId, order.userId, order.challengeId ?? '', code);
        return outcomeOf(result);
      }
      case 'cancel': {
        const order = this.order(step.order);
        return outcomeOf(await cluster.copy(step.copy).calls.cancel(order.orderId, order.userId));
      }
      case 'sweep': {
        const round = await cluster.copy(step.copy).sweep();
        return JSON.stringify(round);
      }
      case 'inventory-sweep':
        await this.world.sweepInventory();
        return 'ok';
      case 'advance':
        this.world.clock.advance(step.ms);
        return 'ok';
      case 'relay':
        await cluster.copy(step.copy).relay();
        return `akis ${String(cluster.stream.length)}`;
      case 'deliver': {
        const outcomes = await cluster.deliverPaymentCommands(this.delivered);
        this.delivered = cluster.stream.length;
        const rejected = outcomes.filter((outcome) => outcome.kind !== 'handled').length;
        if (rejected > 0)
          return `ERR ${ERROR_CODES.INTERNAL} (${String(rejected)} komut reddedildi)`;
        return `${String(outcomes.length)} komut`;
      }
    }
  }

  private order(index: number): Tracked {
    const order = this.tracked[index];
    if (order === undefined) throw new Error(`izlenen siparis yok: o${String(index)}`);
    return order;
  }
}

/** Cevabin ozeti: durum adi ya da `ERR <kod>`. */
function outcomeOf(result: CallResult<{ readonly status: orderV1.OrderStatus }>): string {
  if (result.error !== undefined) {
    return `ERR ${appErrorOf(result.error)?.code ?? `${NOT_APP_ERROR} (${result.error.message})`}`;
  }
  return orderV1.orderStatusToJSON(result.response?.status ?? orderV1.OrderStatus.UNRECOGNIZED);
}

function describeStep(step: Step, tracked: readonly Tracked[]): string {
  const copy = 'copy' in step ? `k${String(step.copy)} ` : '';
  const target =
    'order' in step ? ` o${String(step.order)}(${tracked[step.order]?.band ?? '?'})` : '';
  switch (step.kind) {
    case 'new':
      return `${copy}new ${step.band}`;
    case 'card':
      return `${copy}card${target} ${step.card}`;
    case 'confirm':
      return `${copy}confirm${target} ${step.right ? 'dogru' : 'yanlis'}`;
    case 'advance':
      return `advance ${String(step.ms)}ms`;
    default:
      return `${copy}${step.kind}${target}`;
  }
}

const BANDS: readonly RiskBand[] = [
  RISK_BANDS.LOW,
  RISK_BANDS.LOW,
  RISK_BANDS.LOW,
  RISK_BANDS.MEDIUM,
  RISK_BANDS.MEDIUM,
  RISK_BANDS.HIGH,
  RISK_BANDS.CRITICAL,
];
const CARDS: readonly Card[] = ['APPROVED', 'APPROVED', 'CHALLENGE', 'CHALLENGE', 'DECLINED'];
/** Saat adimlari: 3DS penceresi (60 sn), orta bant kilidi ve taslak kilidi (600 sn) civari. */
const ADVANCES_MS: readonly number[] = [5_000, 30_000, 70_000, 200_000, 400_000, 700_000];
/** [agirlik, adim turu]; siparis isteyen adim siparis yoksa yeni siparis olur. */
const WEIGHTS = [
  [4, 'new'],
  [5, 'card'],
  [2, 'cod'],
  [4, 'confirm'],
  [2, 'cancel'],
  [2, 'sweep'],
  [1, 'inventory-sweep'],
  [2, 'advance'],
  [2, 'relay'],
  [1, 'deliver'],
] as const;
const TOTAL_WEIGHT = WEIGHTS.reduce((sum, [weight]) => sum + weight, 0);

/** Tohumlu uretecten bir adim; secimlerin hepsi burada (uygulamadan once). */
export function randomStep(next: () => number, tracked: readonly Tracked[]): Step {
  const pick = <T>(list: readonly T[]): T => {
    const value = list[Math.floor(next() * list.length)];
    if (value === undefined) throw new Error('bos liste');
    return value;
  };
  const copy = next() < 0.5 ? 0 : 1;
  let roll = next() * TOTAL_WEIGHT;
  let kind: (typeof WEIGHTS)[number][1] = 'new';
  for (const [weight, candidate] of WEIGHTS) {
    roll -= weight;
    if (roll < 0) {
      kind = candidate;
      break;
    }
  }
  const order = Math.floor(next() * tracked.length);
  const challenged = tracked.flatMap((entry, index) => (entry.challengeId ? [index] : []));
  switch (kind) {
    case 'new':
      return { kind, copy, band: pick(BANDS) };
    case 'card':
      return tracked.length === 0
        ? { kind: 'new', copy, band: pick(BANDS) }
        : { kind, copy, order, card: pick(CARDS) };
    case 'cod':
    case 'cancel':
      return tracked.length === 0
        ? { kind: 'new', copy, band: pick(BANDS) }
        : { kind, copy, order };
    case 'confirm':
      return challenged.length === 0
        ? { kind: 'new', copy, band: pick(BANDS) }
        : { kind, copy, order: pick(challenged), right: next() < 0.6 };
    case 'sweep':
    case 'relay':
      return { kind, copy };
    case 'advance':
      return { kind, ms: pick(ADVANCES_MS) };
    case 'inventory-sweep':
    case 'deliver':
      return { kind };
  }
}
