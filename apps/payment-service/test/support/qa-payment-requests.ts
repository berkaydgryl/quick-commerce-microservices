/**
 * QA (T15.2, payment PQ1-PQ3): payment ve kart kasasi istekleri, belgeden para okuma. Kimlikler
 * uretimdeki bicimde (ord_/usr_ + 32 onaltilik); kartlar mock saglayicinin test kartlari
 * (test-cards.ts). Para belgenin DENEME GECMISINDEN okunur: durum alanina degil, olana bakilir.
 */

import { ID_PREFIX, MOCK_THREEDS_CODE, newId } from '@getir/core';
import { cardvaultV1, paymentV1 } from '@getir/proto';

import { ATTEMPT_KIND, ATTEMPT_OUTCOME } from '../../src/domain/payment.js';
import { TEST_CARDS } from '../../src/infrastructure/mock-provider/test-cards.js';
import type { PaymentDocument } from '../../src/infrastructure/mongo/documents.js';

export const Payments = paymentV1.PaymentServiceService;
export const Vault = cardvaultV1.CardVaultServiceService;
export const STATUS = paymentV1.PaymentStatus;

export const AMOUNT_MINOR = 12_990;
export const RIGHT_CODE = MOCK_THREEDS_CODE;
export const WRONG_CODE = '000000';

/** Test kartinin mock saglayicidaki jetonu (test-cards.ts tek kaynak: jeton degisirse burasi izler). */
export function tokenOf(number: string): string {
  const entry = Object.entries(TEST_CARDS).find(([, card]) => card.number === number);
  if (entry === undefined) throw new Error(`mock saglayicida test karti yok: ${number}`);
  return entry[0];
}

/** Test kartlari (jeton): onay, ret, 3DS. */
export const TOKEN = {
  APPROVE: tokenOf('4242 4242 4242 4242'),
  DECLINE: tokenOf('4000 0000 0000 0002'),
  CHALLENGE: tokenOf('4000 0027 6000 3184'),
} as const;
/** Kasaya eklenen kart: mock 0 TL dogrulamasi onaylar, cekimde APPROVED. */
export const SAVED_CARD_NUMBER = '5555 5555 5555 4444';

export type Source =
  | { readonly kind: 'token'; readonly token: string }
  | { readonly kind: 'saved'; readonly cardId: string }
  | { readonly kind: 'cod' };

export interface Order {
  readonly orderId: string;
  readonly userId: string;
  /** Siparisin anahtari; ayni siparise baska anahtarla istek PQ2(b). */
  readonly key: string;
}

export function newUser(): string {
  return newId(ID_PREFIX.USER);
}

export function newOrder(userId = newUser()): Order {
  const orderId = newId(ID_PREFIX.ORDER);
  return { orderId, userId, key: `qa-charge-${orderId}` };
}

export function chargeRequest(
  order: Order,
  source: Source,
  overrides: Partial<paymentV1.ChargeRequest> = {},
): paymentV1.ChargeRequest {
  return {
    orderId: order.orderId,
    userId: order.userId,
    amount: { amountMinor: AMOUNT_MINOR, currency: 'TRY' },
    method:
      source.kind === 'cod'
        ? paymentV1.PaymentMethod.PAYMENT_METHOD_CASH_ON_DELIVERY
        : paymentV1.PaymentMethod.PAYMENT_METHOD_CARD,
    cardToken: source.kind === 'token' ? source.token : '',
    cardId: source.kind === 'saved' ? source.cardId : '',
    idempotencyKey: order.key,
    requireThreeDs: false,
    ...overrides,
  };
}

export function confirmRequest(
  order: Order,
  challengeId: string,
  code: string,
): paymentV1.Confirm3DsRequest {
  return { orderId: order.orderId, challengeId, code };
}

export function refundRequest(order: Order, reason = 'order_cancelled'): paymentV1.RefundRequest {
  return { orderId: order.orderId, reason, idempotencyKey: `qa-refund-${order.orderId}` };
}

export function addCardRequest(userId: string): cardvaultV1.AddCardRequest {
  return {
    userId,
    number: SAVED_CARD_NUMBER,
    expiryMonth: 12,
    expiryYear: 2031,
    cvv: '987',
    holderName: 'QA Persona',
    nickname: '',
  };
}

/** Belgedeki para: cekildi mi (onay ya da kabul edilen 3DS), kac iade, kac yanlis kod. */
export interface Money {
  readonly charged: number;
  readonly refunded: number;
  readonly rejectedCodes: number;
  readonly acceptedCodes: number;
  readonly cancels: number;
}

export function moneyOf(document: PaymentDocument): Money {
  const count = (kind: string, outcome: string) =>
    document.attempts.filter((attempt) => attempt.kind === kind && attempt.outcome === outcome)
      .length;
  const acceptedCodes = count(ATTEMPT_KIND.THREEDS, ATTEMPT_OUTCOME.CODE_ACCEPTED);
  return {
    charged: count(ATTEMPT_KIND.CHARGE, ATTEMPT_OUTCOME.APPROVED) + acceptedCodes,
    refunded: count(ATTEMPT_KIND.REFUND, ATTEMPT_OUTCOME.REFUNDED),
    rejectedCodes: count(ATTEMPT_KIND.THREEDS, ATTEMPT_OUTCOME.CODE_REJECTED),
    acceptedCodes,
    cancels: count(ATTEMPT_KIND.CANCEL, ATTEMPT_OUTCOME.CANCELLED),
  };
}

/** `count` vaat yerlesince cozulur (kalanlar bekler): kapida bekleyen kazanani ayirmak icin. */
export function whenSettled(promises: readonly Promise<unknown>[], count: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = 0;
    if (count <= 0) resolve();
    for (const promise of promises) {
      const done = () => {
        settled += 1;
        if (settled === count) resolve();
      };
      promise.then(done, done);
    }
  });
}
