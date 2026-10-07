/**
 * QA PQ1 (T15.2): para korunumu ozellik testinin MODELI. Islemler, izlenen siparisler ve
 * kartlar; her islemin izinli sonuc kodlari. Degismezler qa-payment-invariants.ts'te.
 *
 * Belirlenimcilik: tohum ISLEM PLANINI belirler. Her islem butun rastgele secimlerini ILK
 * beklemeden (await) once yapar; yeniden teslim kopyasi rastgele degil (sirayla). Boylece es
 * zamanli cagrilarin donus sirasi uretecin akisini degistirmez. Turlar icindeki yarislarin SONUCU
 * (or. silme ile Charge) sonraki secimleri etkileyebilir; degismezler her sonucta gecerlidir.
 */

import { ERROR_CODES, EVENTS, isAppError } from '@getir/core';
import type { EventEnvelope, EventOutcome } from '@getir/event-bus';
import { DEFAULT_DELIVERY_SETTINGS } from '@getir/event-bus';
import { appErrorOf } from '@getir/service-kit/testing';

import { CANCEL_OUTCOME } from '../../src/application/cancel-payment.js';
import { cancelCommand } from './cancel-command.js';
import type { PaymentCluster } from './qa-payment-cluster.js';
import {
  addCardRequest,
  AMOUNT_MINOR,
  chargeRequest,
  confirmRequest,
  newOrder,
  newUser,
  Payments,
  refundRequest,
  RIGHT_CODE,
  tokenOf,
  TOKEN,
  Vault,
  WRONG_CODE,
} from './qa-payment-requests.js';
import type { Order, Source } from './qa-payment-requests.js';
import { refundCommand } from './refund-command.js';

export const MAX_DELIVERIES = DEFAULT_DELIVERY_SETTINGS.maxDeliveries;
const DEFAULT_SEED = 0x9a1d0715;
const USERS = 6;
const CLOCK_STEP_MS = 20_000;
/** Kasaya eklenebilen iki onayli kart; cekimde YALNIZ kayitli kartla kullanilir (jeton denetimi). */
const SAVED_NUMBERS = ['5555 5555 5555 4444', '9792 0000 0000 0003'] as const;
export const SAVED_TOKENS: readonly string[] = SAVED_NUMBERS.map(tokenOf);

/**
 * Tohum: ortam degiskeni (ondalik ya da 0x..., en fazla 32 bit) ya da sabit tohum; gecersiz deger
 * sessizce yutulmaz. Varsayilan payment PQ1'in; order OQ1 kendi degisken adi ve tohumuyla cagirir.
 */
export function seedOf(
  raw: string | undefined,
  name = 'QA_PAYMENT_SEED',
  fallback = DEFAULT_SEED,
): number {
  if (raw === undefined || raw === '') return fallback;
  const seed = /^(0x[0-9a-f]+|[0-9]+)$/i.test(raw) ? Number(raw) : Number.NaN;
  // Uretec 32 bitlik durumla calisir: buyuk tohum kesilip baska tohumun planini kosmasin.
  if (!Number.isSafeInteger(seed) || seed > 0xffffffff) throw new Error(`${name} gecersiz: ${raw}`);
  return seed;
}

/** Sabit tohumlu uretec (mulberry32). */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

interface Tracked {
  readonly order: Order;
  readonly source: Source;
  readonly requireThreeDs: boolean;
  challengeId?: string;
  cancelled: boolean;
  /** Bir Charge kayit yazdi: tekrar 'ok', baska anahtar ya da tutar CONFLICT olmali. */
  hasPayment: boolean;
}

interface Pending {
  readonly envelope: EventEnvelope;
  readonly copy: number;
  readonly attempt: number;
}

export class Run {
  readonly orders: Tracked[] = [];
  /** Kullanicinin silinmemis kartlari (silme islemi baslarken ESZAMANLI cikarilir). */
  readonly cards = new Map<string, string[]>();
  /** Silinmesi ONAYLANMIS kartlar: onlarla Charge NOT_FOUND olmali, kayit yazilmamali. */
  readonly deletedCards = new Map<string, string[]>();
  readonly users = Array.from({ length: USERS }, () => newUser());
  readonly redeliver: Pending[] = [];
  /** Iptal komutu odeme KAYDINI gorerek islendi (I6). */
  readonly cancelled = new Set<string>();
  /** Iptal komutu "odeme yok" dedi (#136 penceresi adayi). */
  readonly cancelledWithoutPayment = new Set<string>();
  readonly unexpected: string[] = [];
  readonly seen = new Set<string>();

  constructor(
    readonly cluster: PaymentCluster,
    readonly next: () => number,
  ) {}

  pick<T>(items: readonly T[]): T | undefined {
    return items[Math.floor(this.next() * items.length)];
  }

  copy(): number {
    return Math.floor(this.next() * this.cluster.copies.length);
  }

  /** Sonuc izinli kumede mi; degilse beklenmedik olarak yazilir. */
  expectCode(operation: string, error: unknown, allowed: readonly string[]): void {
    const code = codeOf(error);
    this.seen.add(`${operation}:${code}`);
    if (!allowed.includes(code)) this.unexpected.push(`${operation}: ${code}`);
  }
}

/** gRPC hatasi (x-app-error) ya da isleyicinin firlattigi AppError; yoksa 'ok'. */
function codeOf(error: unknown): string {
  if (error === undefined) return 'ok';
  if (isAppError(error)) return error.code;
  return appErrorOf(error)?.code ?? (error instanceof Error ? error.message : 'bilinmeyen hata');
}

function track(userId: string, source: Source, requireThreeDs = false): Tracked {
  return { order: newOrder(userId), source, requireThreeDs, cancelled: false, hasPayment: false };
}

async function charge(
  run: Run,
  tracked: Tracked,
  copy: number,
  operation: string,
  allowed: readonly string[],
  overrides: { amountMinor?: number; key?: string } = {},
): Promise<void> {
  const order =
    overrides.key === undefined ? tracked.order : { ...tracked.order, key: overrides.key };
  const request = chargeRequest(order, tracked.source, {
    requireThreeDs: tracked.requireThreeDs,
    ...(overrides.amountMinor === undefined
      ? {}
      : { amount: { amountMinor: overrides.amountMinor, currency: 'TRY' } }),
  });
  const { response, error } = await run.cluster.copy(copy).call(Payments.charge, request);
  run.expectCode(operation, error, allowed);
  if (response?.challengeId) tracked.challengeId = response.challengeId;
  if (error === undefined && Object.keys(overrides).length === 0) tracked.hasPayment = true;
}

/** Yeni siparis ve ilk Charge; butun secimler ilk beklemeden once. */
async function chargeNew(run: Run): Promise<void> {
  const userId = run.pick(run.users) ?? newUser();
  const roll = run.next();
  const requireThreeDs = run.next() < 0.2;
  const copy = run.copy();
  const cardCopy = run.copy();
  const numberIndex = Math.floor(run.next() * SAVED_NUMBERS.length);
  const deleted = run.pick(run.deletedCards.get(userId) ?? []);
  const active = run.pick(run.cards.get(userId) ?? []);
  if (roll < 0.25) return newCharge({ kind: 'token', token: TOKEN.APPROVE });
  if (roll < 0.35) return newCharge({ kind: 'token', token: TOKEN.DECLINE });
  if (roll < 0.6) return newCharge({ kind: 'token', token: TOKEN.CHALLENGE });
  if (roll < 0.72) return newCharge({ kind: 'cod' });
  if (roll < 0.76 && deleted !== undefined) {
    // Silinmesi onaylanmis kart: kesin NOT_FOUND, kayit yok.
    return newCharge({ kind: 'saved', cardId: deleted }, [ERROR_CODES.NOT_FOUND]);
  }
  const cardId = active ?? (await addCard(run, userId, numberIndex, cardCopy));
  // Etkin kart ayni turdaki bir silmeyle yarisabilir: ok ya da NOT_FOUND.
  return newCharge(cardId === undefined ? { kind: 'cod' } : { kind: 'saved', cardId }, [
    'ok',
    ERROR_CODES.NOT_FOUND,
  ]);

  function newCharge(source: Source, allowed: readonly string[] = ['ok']): Promise<void> {
    const tracked = track(userId, source, source.kind !== 'cod' && requireThreeDs);
    run.orders.push(tracked);
    return charge(run, tracked, copy, 'charge', allowed);
  }
}

async function addCard(
  run: Run,
  userId: string,
  numberIndex: number,
  copy: number,
  allowed: readonly string[] = ['ok', ERROR_CODES.CONFLICT],
): Promise<string | undefined> {
  const { response, error } = await run.cluster.copy(copy).call(Vault.addCard, {
    ...addCardRequest(userId),
    number: SAVED_NUMBERS[numberIndex] ?? SAVED_NUMBERS[0],
  });
  run.expectCode('addCard', error, allowed);
  const cardId = response?.card?.id;
  if (cardId !== undefined) run.cards.set(userId, [...(run.cards.get(userId) ?? []), cardId]);
  return cardId;
}

/** Kart model listesinden ESZAMANLI cikar: ayni turda ikinci silme ayni karti secemez. */
async function deleteCard(run: Run, userId: string, cardId: string, copy: number): Promise<void> {
  run.cards.set(
    userId,
    (run.cards.get(userId) ?? []).filter((id) => id !== cardId),
  );
  const { error } = await run.cluster.copy(copy).call(Vault.deleteCard, { userId, cardId });
  run.expectCode('deleteCard', error, ['ok']);
  if (error === undefined) {
    run.deletedCards.set(userId, [...(run.deletedCards.get(userId) ?? []), cardId]);
  }
}

async function confirm(
  run: Run,
  tracked: Tracked,
  code: string,
  copy: number,
  allowed: readonly string[],
): Promise<void> {
  const { error } = await run.cluster
    .copy(copy)
    .call(Payments.confirm3Ds, confirmRequest(tracked.order, tracked.challengeId ?? '', code));
  run.expectCode(`confirm-${code === RIGHT_CODE ? 'dogru' : 'yanlis'}`, error, allowed);
}

async function refund(
  run: Run,
  tracked: Tracked,
  copy: number,
  allowed: readonly string[],
): Promise<void> {
  const { error } = await run.cluster
    .copy(copy)
    .call(Payments.refund, refundRequest(tracked.order, 'order_changed_during_payment'));
  run.expectCode('refund', error, allowed);
}

/** Komutu teslim eder; onaylanmazsa event-bus gibi sonraki turda (sirayla diger kopya). */
export async function deliver(run: Run, pending: Pending): Promise<void> {
  const label = pending.envelope.topic;
  const orderId = String(pending.envelope.partitionKey);
  let outcome: EventOutcome;
  try {
    outcome = await run.cluster.copy(pending.copy).deliver(pending.envelope, pending.attempt);
  } catch (error: unknown) {
    // Cekim suruyor ya da surum cakismasi (iptal bir kez yeniden okur): yeniden teslim edilir.
    run.expectCode(label, error, [ERROR_CODES.REQUEST_IN_PROGRESS, ERROR_CODES.CONFLICT]);
    if (pending.attempt >= MAX_DELIVERIES) {
      run.unexpected.push(`${label} ${orderId}: hak bitti, olu olay`);
      return;
    }
    const copy = (pending.copy + 1) % run.cluster.copies.length;
    run.redeliver.push({ ...pending, attempt: pending.attempt + 1, copy });
    return;
  }
  run.seen.add(`${label}:${outcome.kind}`);
  if (outcome.kind === 'handled' && label === EVENTS.PAYMENT_CANCEL_REQUESTED) {
    // Isleyicinin GERCEK sonucu gunlukte (cancel-requested.ts): kayit gorduyse I6 uygulanir.
    const withoutPayment = cancelOutcomeOf(run, orderId) === CANCEL_OUTCOME.NO_PAYMENT;
    (withoutPayment ? run.cancelledWithoutPayment : run.cancelled).add(orderId);
  }
}

function cancelOutcomeOf(run: Run, orderId: string): unknown {
  const lines = run.cluster.lines;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const fields = lines[index]?.fields;
    if (fields?.orderId === orderId && typeof fields.outcome === 'string') return fields.outcome;
  }
  return undefined;
}

function command(run: Run, tracked: Tracked, cancel: boolean, copy: number): Promise<void> {
  const at = run.cluster.clock.date();
  if (cancel) tracked.cancelled = true;
  const envelope = cancel
    ? cancelCommand(tracked.order.orderId, at)
    : refundCommand(tracked.order.orderId, at);
  return deliver(run, { envelope, copy, attempt: 1 });
}

/** Tek islem: agirliklar her yolun sik denenmesine gore; secimler ilk beklemeden once. */
export function operation(run: Run): Promise<void> {
  const roll = run.next();
  const copy = run.copy();
  const open = run.orders.filter((entry) => !entry.cancelled);
  if (roll < 0.34 || open.length === 0) return chargeNew(run);
  const tracked = run.pick(open);
  if (tracked === undefined) return chargeNew(run);
  if (roll < 0.42) {
    // Kaydi olan siparisin tekrari hep 'ok'; kaydi yoksa (kart silinmisti) NOT_FOUND olabilir.
    const allowed = tracked.hasPayment ? ['ok'] : ['ok', ERROR_CODES.NOT_FOUND];
    return charge(run, tracked, copy, 'replay', allowed);
  }
  // Kaydi olan siparise baska tutar ya da baska anahtar: hep CONFLICT, saglayiciya gidilmez.
  const paid = run.pick(open.filter((entry) => entry.hasPayment));
  if (roll < 0.45 && paid !== undefined) {
    return charge(run, paid, copy, 'otherAmount', [ERROR_CODES.CONFLICT], {
      amountMinor: AMOUNT_MINOR + 1,
    });
  }
  if (roll < 0.48 && paid !== undefined) {
    return charge(run, paid, copy, 'otherKey', [ERROR_CODES.CONFLICT], {
      key: `${paid.order.key}-baska`,
    });
  }
  if (roll < 0.66) {
    const challenged = run.pick(open.filter((entry) => entry.challengeId !== undefined));
    const code = run.next() < 0.4 ? RIGHT_CODE : WRONG_CODE;
    if (challenged === undefined) return Promise.resolve();
    // NOT_FOUND: ayni turdaki iptal komutu 3DS'i kapatti (CANCELLED odemede dogrulama yok).
    const allowed = ['ok', ERROR_CODES.THREEDS_FAILED, ERROR_CODES.CONFLICT, ERROR_CODES.NOT_FOUND];
    return confirm(run, challenged, code, copy, allowed);
  }
  if (roll < 0.73) {
    return refund(run, tracked, copy, ['ok', ERROR_CODES.CONFLICT, ERROR_CODES.NOT_FOUND]);
  }
  if (roll < 0.81) return command(run, tracked, true, copy);
  if (roll < 0.85) return command(run, tracked, false, copy);
  const userId = run.pick(run.users) ?? newUser();
  if (roll < 0.91) {
    const numberIndex = Math.floor(run.next() * SAVED_NUMBERS.length);
    return addCard(run, userId, numberIndex, copy).then(() => undefined);
  }
  const cardId = run.pick(run.cards.get(userId) ?? []);
  if (roll < 0.95)
    return cardId === undefined ? Promise.resolve() : deleteCard(run, userId, cardId, copy);
  run.cluster.clock.advance(CLOCK_STEP_MS);
  return Promise.resolve();
}

/**
 * Belirlenimci giris: her yol ve her son durum SIRAYLA bir kez, rastgele asamanin dokunmadigi
 * siparislerde (run.orders'a girmez). Kapsam denetimi boylece zamanlamaya bagli olmaz.
 */
export async function prelude(run: Run): Promise<void> {
  const userId = run.users[0] ?? newUser();
  const approved = track(userId, { kind: 'token', token: TOKEN.APPROVE });
  await charge(run, approved, 0, 'charge', ['ok']);
  await charge(run, approved, 1, 'replay', ['ok']);
  await charge(run, approved, 0, 'otherAmount', [ERROR_CODES.CONFLICT], {
    amountMinor: AMOUNT_MINOR + 1,
  });
  await charge(run, approved, 1, 'otherKey', [ERROR_CODES.CONFLICT], {
    key: `${approved.order.key}-baska`,
  });
  const declined = track(userId, { kind: 'token', token: TOKEN.DECLINE });
  await charge(run, declined, 0, 'charge', ['ok']);
  await refund(run, declined, 1, [ERROR_CODES.CONFLICT]);
  await charge(run, track(userId, { kind: 'token', token: TOKEN.CHALLENGE }), 0, 'charge', ['ok']);
  await charge(run, track(userId, { kind: 'cod' }), 1, 'charge', ['ok']);
  const refunded = track(userId, { kind: 'token', token: TOKEN.APPROVE });
  await charge(run, refunded, 0, 'charge', ['ok']);
  await refund(run, refunded, 1, ['ok']);
  const cancelled = track(userId, { kind: 'cod' });
  await charge(run, cancelled, 0, 'charge', ['ok']);
  await command(run, cancelled, true, 1);
  const threeDs = track(userId, { kind: 'token', token: TOKEN.CHALLENGE });
  await charge(run, threeDs, 0, 'charge', ['ok']);
  await confirm(run, threeDs, WRONG_CODE, 1, [ERROR_CODES.THREEDS_FAILED]);
  await confirm(run, threeDs, RIGHT_CODE, 0, ['ok']);
  const cardId = (await addCard(run, userId, 0, 1, ['ok'])) ?? '';
  await charge(run, track(userId, { kind: 'saved', cardId }), 0, 'charge', ['ok']);
  await deleteCard(run, userId, cardId, 1);
  await charge(run, track(userId, { kind: 'saved', cardId }), 0, 'charge', [ERROR_CODES.NOT_FOUND]);
}
