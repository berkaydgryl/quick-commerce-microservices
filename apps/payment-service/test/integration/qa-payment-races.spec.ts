/**
 * QA PQ2 (T15.2, payment geriye donuk): N'li yarislar iki payment kopyasinda, tek Mongo'da
 * (qa-payment-cluster.ts). Birim testleri ikili yarisi bellek deposunda sinar; burada uretimin
 * unique indeksleri ve iyimser kilidi gercek veritabaninda, iki ayri baglanti ve sunucuyla, cok
 * sayida es zamanli istekle. Yarislar saglayici kapisiyla hizalanir (uyku yok).
 *
 *   a) ayni anahtarla 32 Charge: tek kayit, tek authorize. Kazanan kapidayken kaybedenler onun
 *      PENDING kaydini doner (order bunu REQUEST_IN_PROGRESS sayip tekrar dener) ya da iki okuma
 *      arasindaki pencereye dusup CONFLICT alir (BULGU #144, a3); kapi acilinca SUCCEEDED.
 *   a2) insert yarisi (kapiyla, belirlenimci): kaybeden kazananin PENDING kaydini alir.
 *   a3) MEVCUT davranis (kapiyla): findReplay ile findByOrderId arasinda kalan kaybeden CONFLICT alir.
 *   b) ayni siparise 16 farkli anahtar: tek kazanan, 15 CONFLICT, ikinci authorize yok.
 *   c) 3DS: 20 es zamanli yanlis kod TAM uc hak yakar; dogru kod yanlislarin arasindayken ya
 *      SUCCEEDED ya FAILED, ikisi birden asla. Yeniden yazma hakki (3) bitince CONFLICT kabul, ama
 *      her sonucta kaydedilen hak cevaplarla tutarli: kayip ya da fazladan hak yok.
 *   d) Refund RPC + cancel_requested + refund_requested ayni anda: her sipariste TEK iade.
 *   e) kayitli kart: silme ile Charge yarisi; silindikten sonra odeme NOT_FOUND; jeton belgede yok.
 */

import { ERROR_CODES } from '@getir/core';
import { EVENT_HANDLED } from '@getir/event-bus';
import { appErrorOf } from '@getir/service-kit/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { THREEDS_MAX_ATTEMPTS } from '../../src/config/constants.js';
import { cancelCommand } from '../support/cancel-command.js';
import type { Payment } from '../../src/domain/payment.js';
import type { PaymentRepository } from '../../src/domain/payment-repository.js';
import { gate, mongoEnv, startCluster, useMongo } from '../support/qa-payment-cluster.js';
import type { PaymentCluster } from '../support/qa-payment-cluster.js';
import {
  addCardRequest,
  chargeRequest,
  confirmRequest,
  moneyOf,
  newOrder,
  Payments,
  refundRequest,
  RIGHT_CODE,
  STATUS,
  TOKEN,
  Vault,
  whenSettled,
  WRONG_CODE,
} from '../support/qa-payment-requests.js';
import type { Order } from '../support/qa-payment-requests.js';
import { refundCommand } from '../support/refund-command.js';

const mongo = useMongo();
const TEST_TIMEOUT_MS = 60_000;
const SAME_KEY_CALLS = 32;
const OTHER_KEYS = 16;
const CONCURRENT_CODES = 20;
const ROUNDS = 10;

let cluster: PaymentCluster | undefined;
afterEach(async () => {
  // Once sifirlanir: kapanis duserse sonraki test eski kumeyi yeniden kapatmaya calismaz.
  const running = cluster;
  cluster = undefined;
  await running?.stop();
});

async function open(paused?: (repository: PaymentRepository) => PaymentRepository) {
  const env = mongoEnv(mongo().uri);
  cluster = await startCluster({
    copies: [env, env],
    inspect: env,
    ...(paused === undefined
      ? {}
      : { wrap: (repository, copy) => (copy === 1 ? paused(repository) : repository) }),
  });
  return cluster;
}

type Step = 'findByOrderId' | 'insert';

/** Kopyanin deposu verilen adimdan ONCE bir kez durur: yaris penceresi belirlenimci acilir. */
class PausedStep implements PaymentRepository {
  readonly arrived = gate();
  readonly release = gate();
  private inner: PaymentRepository | undefined;

  constructor(private pending: Step | undefined) {}

  wrap = (inner: PaymentRepository): PaymentRepository => {
    this.inner = inner;
    return this;
  };

  async insert(payment: Payment): Promise<void> {
    await this.step('insert');
    return this.repository().insert(payment);
  }

  update(payment: Payment, expectedVersion: number): Promise<void> {
    return this.repository().update(payment, expectedVersion);
  }

  async findByOrderId(orderId: string): Promise<Payment | null> {
    await this.step('findByOrderId');
    return this.repository().findByOrderId(orderId);
  }

  findByIdempotencyKey(idempotencyKey: string): Promise<Payment | null> {
    return this.repository().findByIdempotencyKey(idempotencyKey);
  }

  private async step(name: Step): Promise<void> {
    if (this.pending !== name) return;
    this.pending = undefined;
    this.arrived.open();
    await this.release.opened;
  }

  private repository(): PaymentRepository {
    if (this.inner === undefined) throw new Error('sarilmamis depo');
    return this.inner;
  }
}

/**
 * Kaybeden (kopya 1) `step`'ten once durur; kazanan (kopya 0) PENDING'i yazip saglayicida
 * bekler; sonra kaybeden devam eder. Kaybedenin cevabi doner, kazanan SUCCEEDED olur.
 */
async function loserAfterWinnerInsert(step: Step) {
  const paused = new PausedStep(step);
  const target = await open(paused.wrap);
  const order = newOrder();
  const request = chargeRequest(order, { kind: 'token', token: TOKEN.APPROVE });
  const loser = target.copy(1).call(Payments.charge, request);
  await paused.arrived.opened;
  const held = target.provider.holdAuthorize();
  const winner = target.copy(0).call(Payments.charge, request);
  await held.arrived;
  paused.release.open();
  const lost = await loser;
  held.release();
  expect((await winner).response?.payment?.status).toBe(STATUS.PAYMENT_STATUS_SUCCEEDED);
  expect(target.provider.authorized).toBe(1);
  expect(await target.documents()).toHaveLength(1);
  return { lost, winner: await winner };
}

/** 3DS bekleyen odeme acar; jetonu doner. */
async function challenged(target: PaymentCluster, order: Order): Promise<string> {
  const { response } = await target
    .copy(0)
    .call(Payments.charge, chargeRequest(order, { kind: 'token', token: TOKEN.CHALLENGE }));
  expect(response?.payment?.status).toBe(STATUS.PAYMENT_STATUS_REQUIRES_3DS);
  return response?.challengeId ?? '';
}

/**
 * 3DS turunun sonucu kayitla tutarli mi (c2 ve c3): dogru kodun cevabi, kabul ve ret sayilari,
 * kalan hakki soyleyen yanlis kodlar. Hangi dal oldugunu doner.
 */
async function expectCodesConsistent(
  target: PaymentCluster,
  order: Order,
  outcomes: readonly string[],
  right: number,
): Promise<string> {
  const document = await target.documentOf(order.orderId);
  const money = moneyOf(document);
  const wrong = outcomes.filter((outcome) => outcome.startsWith('wrong_code'));
  if (document.status === 'SUCCEEDED') {
    expect(outcomes[right]).toBe('succeeded');
    expect(money).toMatchObject({ acceptedCodes: 1, charged: 1 });
    expect(money.rejectedCodes).toBeLessThan(THREEDS_MAX_ATTEMPTS);
    // Basaridan once yazan her yanlis kod kendi hakkini soyledi.
    expect(wrong).toHaveLength(money.rejectedCodes);
  } else {
    expect(document).toMatchObject({
      status: 'FAILED',
      threeDS: { closedReason: 'attempts_exhausted' },
    });
    expect(money).toMatchObject({ acceptedCodes: 0, charged: 0 });
    expect(money.rejectedCodes).toBe(THREEDS_MAX_ATTEMPTS);
    expect(outcomes[right]).not.toBe('succeeded');
    expect(wrong).toHaveLength(THREEDS_MAX_ATTEMPTS - 1);
  }
  return document.status;
}

async function paid(target: PaymentCluster, order: Order): Promise<void> {
  const { response } = await target
    .copy(0)
    .call(Payments.charge, chargeRequest(order, { kind: 'token', token: TOKEN.APPROVE }));
  expect(response?.payment?.status).toBe(STATUS.PAYMENT_STATUS_SUCCEEDED);
}

/** 3DS cevabinin ozeti: basari, hak ayrintili ret ya da baska kod. */
function codeOutcome(result: { readonly error?: Error | undefined }): string {
  if (result.error === undefined) return 'succeeded';
  const error = appErrorOf(result.error);
  if (error?.code !== ERROR_CODES.THREEDS_FAILED) return String(error?.code);
  const details = error.details as { attemptsLeft?: unknown; reason?: unknown } | undefined;
  return `${String(details?.reason)}:${String(details?.attemptsLeft)}`;
}

describe('QA PQ2 payment N li yarislar (iki kopya, tek Mongo)', () => {
  it(
    `a) ayni anahtarla ${SAME_KEY_CALLS} Charge: tek kayit, tek authorize; kaybedenler PENDING, sonra SUCCEEDED`,
    async () => {
      const target = await open();
      const order = newOrder();
      const held = target.provider.holdAuthorize();
      const done: { status?: number | undefined; id?: string | undefined; code?: string }[] = [];
      const calls = Array.from({ length: SAME_KEY_CALLS }, (_, n) =>
        target
          .copy(n)
          .call(Payments.charge, chargeRequest(order, { kind: 'token', token: TOKEN.APPROVE }))
          .then((result) => {
            done.push(
              result.error === undefined
                ? { status: result.response?.payment?.status, id: result.response?.payment?.id }
                : { code: appErrorOf(result.error)?.code ?? result.error.message },
            );
            return result;
          }),
      );

      await held.arrived;
      await whenSettled(calls, SAME_KEY_CALLS - 1);
      // Kazanan saglayicida beklerken: kimse ikinci kez cekmedi; kaybedenler ya onun PENDING
      // kaydini ya da iki okuma arasindaki pencerede CONFLICT gordu (#144, a3).
      expect(target.provider.authorized).toBe(1);
      expect(
        done.filter(
          (entry) => entry.status !== STATUS.PAYMENT_STATUS_PENDING && entry.code !== 'CONFLICT',
        ),
      ).toEqual([]);
      held.release();
      await Promise.all(calls);

      const paid = done.filter((entry) => entry.id !== undefined);
      expect(new Set(paid.map((entry) => entry.id)).size).toBe(1);
      const replay = await target
        .copy(1)
        .call(Payments.charge, chargeRequest(order, { kind: 'token', token: TOKEN.APPROVE }));
      expect(replay.response?.payment?.status).toBe(STATUS.PAYMENT_STATUS_SUCCEEDED);
      expect(target.provider.authorized).toBe(1);
      expect(await target.documents()).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'a2) insert yarisi: iki okumadan da bos donen kaybeden insertte cakisir, kazananin PENDING kaydini alir',
    async () => {
      const { lost, winner } = await loserAfterWinnerInsert('insert');

      expect(lost.error).toBeUndefined();
      expect(lost.response?.payment).toMatchObject({
        id: winner.response?.payment?.id,
        status: STATUS.PAYMENT_STATUS_PENDING,
      });
    },
    TEST_TIMEOUT_MS,
  );

  // #144: duzeltmeyle TERSINE donecek (bulunan kaydin anahtari ve govdesi ayniysa CONFLICT
  // yerine kazananin kaydi doner, a2 gibi).
  it(
    'a3) MEVCUT davranis: findReplay bos, findByOrderId kazanani bulur -> ayni anahtarla CONFLICT',
    async () => {
      const { lost } = await loserAfterWinnerInsert('findByOrderId');

      expect(appErrorOf(lost.error)).toMatchObject({ code: ERROR_CODES.CONFLICT });
      expect(lost.error?.message).toContain('odemesi zaten var');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    `b) ayni siparise ${OTHER_KEYS} farkli anahtar: tek kazanan, digerleri CONFLICT, tek authorize`,
    async () => {
      const target = await open();
      const order = newOrder();
      const held = target.provider.holdAuthorize();
      const calls = Array.from({ length: OTHER_KEYS }, (_, n) =>
        target
          .copy(n)
          .call(
            Payments.charge,
            chargeRequest(
              { ...order, key: `${order.key}-${n}` },
              { kind: 'token', token: TOKEN.APPROVE },
            ),
          ),
      );

      await held.arrived;
      await whenSettled(calls, OTHER_KEYS - 1);
      expect(target.provider.authorized).toBe(1);
      held.release();
      const results = await Promise.all(calls);

      const codes = results.map((result) => appErrorOf(result.error)?.code ?? 'ok');
      expect(codes.filter((code) => code === 'ok')).toHaveLength(1);
      expect(codes.filter((code) => code === ERROR_CODES.CONFLICT)).toHaveLength(OTHER_KEYS - 1);
      expect(await target.documents()).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    `c1) ${CONCURRENT_CODES} es zamanli yanlis kod TAM ${THREEDS_MAX_ATTEMPTS} hak yakar; cevaplar kayitla tutarli`,
    async () => {
      const target = await open();
      for (let round = 0; round < ROUNDS; round += 1) {
        const order = newOrder();
        const challengeId = await challenged(target, order);
        const held = target.provider.holdVerify(CONCURRENT_CODES);
        const calls = Array.from({ length: CONCURRENT_CODES }, (_, n) =>
          target.copy(n).call(Payments.confirm3Ds, confirmRequest(order, challengeId, WRONG_CODE)),
        );
        await held.arrived;
        held.release();
        const outcomes = (await Promise.all(calls)).map(codeOutcome);

        const document = await target.documentOf(order.orderId);
        expect(document).toMatchObject({
          status: 'FAILED',
          threeDS: { failedAttempts: THREEDS_MAX_ATTEMPTS, closedReason: 'attempts_exhausted' },
        });
        expect(moneyOf(document).rejectedCodes).toBe(THREEDS_MAX_ATTEMPTS);
        // Yazan her yanlis kod kalan hakki dogru soyledi: 2 ve 1 birer kez; kapatan ve sonrakiler 0.
        const wrong = outcomes.filter((outcome) => outcome.startsWith('wrong_code'));
        expect(wrong.sort()).toEqual(['wrong_code:1', 'wrong_code:2']);
        // Geri kalan: kapatan yazim ve kilidi goren tekrarlar (0 hak); yazma hakki biterse CONFLICT.
        const other = outcomes.filter((outcome) => !outcome.startsWith('wrong_code'));
        expect(
          other.filter(
            (value) => value !== 'attempts_exhausted:0' && value !== ERROR_CODES.CONFLICT,
          ),
        ).toEqual([]);
        expect(other).toContain('attempts_exhausted:0');
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'c2) dogru kod yanlislarin arasinda: ya SUCCEEDED ya FAILED; hak ve para kayitla tutarli',
    async () => {
      const target = await open();
      for (let round = 0; round < ROUNDS; round += 1) {
        const order = newOrder();
        const challengeId = await challenged(target, order);
        const held = target.provider.holdVerify(CONCURRENT_CODES);
        const right = round % CONCURRENT_CODES;
        const calls = Array.from({ length: CONCURRENT_CODES }, (_, n) =>
          target
            .copy(n)
            .call(
              Payments.confirm3Ds,
              confirmRequest(order, challengeId, n === right ? RIGHT_CODE : WRONG_CODE),
            ),
        );
        await held.arrived;
        held.release();
        const outcomes = (await Promise.all(calls)).map(codeOutcome);

        await expectCodesConsistent(target, order, outcomes, right);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'c3) iki dal da belirlenimci: once dogru kod -> SUCCEEDED; once uc yanlis -> FAILED, dogru kod da reddedilir',
    async () => {
      const target = await open();
      const first = newOrder();
      const firstChallenge = await challenged(target, first);
      const accepted = await target
        .copy(0)
        .call(Payments.confirm3Ds, confirmRequest(first, firstChallenge, RIGHT_CODE));
      const afterSuccess = await Promise.all(
        Array.from({ length: CONCURRENT_CODES - 1 }, (_, n) =>
          target
            .copy(n)
            .call(Payments.confirm3Ds, confirmRequest(first, firstChallenge, WRONG_CODE)),
        ),
      );
      const success = await expectCodesConsistent(
        target,
        first,
        [accepted, ...afterSuccess].map(codeOutcome),
        0,
      );
      expect(success).toBe('SUCCEEDED');

      const second = newOrder();
      const secondChallenge = await challenged(target, second);
      const wrongs = [];
      for (let n = 0; n < THREEDS_MAX_ATTEMPTS; n += 1) {
        wrongs.push(
          await target
            .copy(n)
            .call(Payments.confirm3Ds, confirmRequest(second, secondChallenge, WRONG_CODE)),
        );
      }
      const late = await target
        .copy(1)
        .call(Payments.confirm3Ds, confirmRequest(second, secondChallenge, RIGHT_CODE));
      const failure = await expectCodesConsistent(
        target,
        second,
        [...wrongs, late].map(codeOutcome),
        THREEDS_MAX_ATTEMPTS,
      );
      expect(failure).toBe('FAILED');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'd) Refund RPC + cancel_requested + refund_requested ayni anda: her sipariste TEK iade',
    async () => {
      const target = await open();
      for (let round = 0; round < ROUNDS; round += 1) {
        const order = newOrder();
        await paid(target, order);
        const at = target.clock.date();

        const [rpc, cancelled, refunded] = await Promise.all([
          target.copy(0).call(Payments.refund, refundRequest(order)),
          target.copy(1).deliver(cancelCommand(order.orderId, at)),
          target.copy(0).deliver(refundCommand(order.orderId, at)),
        ]);

        expect(rpc.error).toBeUndefined();
        expect(cancelled).toEqual(EVENT_HANDLED);
        expect(refunded).toEqual(EVENT_HANDLED);
        const document = await target.documentOf(order.orderId);
        expect(document.status).toBe('REFUNDED');
        expect(moneyOf(document)).toMatchObject({ charged: 1, refunded: 1 });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'e) kayitli kart silinirken Charge: ya cekilir ya NOT_FOUND; sonra hep NOT_FOUND, jeton belgede yok',
    async () => {
      const target = await open();
      for (let round = 0; round < ROUNDS; round += 1) {
        const order = newOrder();
        const added = await target.copy(0).call(Vault.addCard, addCardRequest(order.userId));
        const cardId = added.response?.card?.id ?? '';
        expect(cardId).not.toBe('');

        const [charge, deleted] = await Promise.all([
          target.copy(round).call(Payments.charge, chargeRequest(order, { kind: 'saved', cardId })),
          target.copy(round + 1).call(Vault.deleteCard, { userId: order.userId, cardId }),
        ]);

        expect(deleted.error).toBeUndefined();
        await expectChargedOrNotFound(target, order, cardId, charge.error);
      }
      await expectNoTokenStored(target);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'e2) iki dal da belirlenimci: once silme -> NOT_FOUND; once Charge -> kartla cekilir',
    async () => {
      const target = await open();
      const before = newOrder();
      const deletedFirst = await savedCard(target, before.userId);
      await target.copy(1).call(Vault.deleteCard, { userId: before.userId, cardId: deletedFirst });
      const refused = await target
        .copy(0)
        .call(Payments.charge, chargeRequest(before, { kind: 'saved', cardId: deletedFirst }));
      await expectChargedOrNotFound(target, before, deletedFirst, refused.error);
      expect(refused.error).toBeDefined();

      const after = newOrder();
      const chargedFirst = await savedCard(target, after.userId);
      const charged = await target
        .copy(0)
        .call(Payments.charge, chargeRequest(after, { kind: 'saved', cardId: chargedFirst }));
      await target.copy(1).call(Vault.deleteCard, { userId: after.userId, cardId: chargedFirst });
      await expectChargedOrNotFound(target, after, chargedFirst, charged.error);
      expect(charged.error).toBeUndefined();
      await expectNoTokenStored(target);
    },
    TEST_TIMEOUT_MS,
  );
});

async function savedCard(target: PaymentCluster, userId: string): Promise<string> {
  const added = await target.copy(0).call(Vault.addCard, addCardRequest(userId));
  const cardId = added.response?.card?.id ?? '';
  expect(cardId).not.toBe('');
  return cardId;
}

/** Silmeyle yarisan Charge (e, e2): ya kartla cekildi ya NOT_FOUND; sonra hep NOT_FOUND. */
async function expectChargedOrNotFound(
  target: PaymentCluster,
  order: Order,
  cardId: string,
  error: Error | undefined,
): Promise<void> {
  const document = await target.document(order.orderId);
  if (error === undefined) {
    expect(document).toMatchObject({ cardId, status: 'SUCCEEDED' });
  } else {
    expect(appErrorOf(error)).toEqual({
      code: ERROR_CODES.NOT_FOUND,
      details: { resource: 'card' },
    });
    expect(document).toBeNull();
  }
  const later = newOrder(order.userId);
  const after = await target
    .copy(0)
    .call(Payments.charge, chargeRequest(later, { kind: 'saved', cardId }));
  expect(appErrorOf(after.error)?.code).toBe(ERROR_CODES.NOT_FOUND);
  expect(await target.document(later.orderId)).toBeNull();
}

async function expectNoTokenStored(target: PaymentCluster): Promise<void> {
  const stored = JSON.stringify(await target.documents());
  expect(stored).not.toContain('tok_');
  expect(stored).not.toContain('providerToken');
}
