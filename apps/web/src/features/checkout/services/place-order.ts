/**
 * Siparis akisinin adimlari (T12.4). Arayuzden bagimsiz: istemci, saat ve
 * anahtarlar disaridan verilir (testte sahte istemci). Kararlar:
 *   - rezervasyon: niyet anahtari (ayni sepet + adres + tutar = ayni anahtar;
 *     belirsiz sonuc ayni rezervasyonu doner); sonuc KESIN bitince niyet
 *     yenilenir (reserve-intent.ts; QA K9 F1);
 *   - siparis: deneme anahtari (belirsiz sonucta korunur, cevap gelince yenilenir);
 *     KESIN hatada rezervasyon en iyi cabayla birakilir, niyet yenilenir;
 *     kart 404'unde (resource "card") siparis TUTULUR: rezervasyon ve niyet
 *     korunur, ayni siparis baska kartla verilir (held-order.ts; PM K2);
 *   - 3DS: her kod denemesi YENI anahtar (sozlesme kurali); kod sirdir:
 *     yalnizca istek govdesinde gider, saklanmaz;
 *   - birakma (PM karari N2 ve ek sart 1): her cagri yeni anahtar; 200 ve 404
 *     sessiz; 409 REQUEST_IN_PROGRESS "para alinmis olabilir": siparis okunur.
 */

import { AppError, ERROR_CODES } from '@getir/core';
import type { CreateOrderRequest, ReserveCartRequest } from '@getir/contracts';
import { z } from 'zod';

import type { HttpClient } from '../../../shared/api/http-client';
import { isUnknownOutcome } from '../../cards/services/attempt-key';
import type { AttemptKeys } from '../../cards/services/attempt-key';
import { fetchOrder } from '../../orders/api/orders.api';
import { confirmThreeDs, placeOrder, releaseReservation, reserveCart } from '../api/checkout.api';

import { challengeDeadline } from './countdown';
import { heldFingerprint } from './held-order';
import type { HeldOrder } from './held-order';
import type { ReserveIntent } from './reserve-intent';

export interface OrderFlowDeps {
  readonly client: HttpClient;
  /** Monotonik saat (ms). */
  readonly now: () => number;
  /** Rezervasyonun niyet anahtari; kesin sonucta yenilenir (createReserveIntent). */
  readonly reserveIntent: ReserveIntent;
  /** Siparisin deneme anahtari (createAttemptKeys). */
  readonly orderAttempts: AttemptKeys;
  /** Her cagrida yeni anahtar (3DS, birakma). */
  readonly newKey: () => string;
}

export type PlaceOutcome =
  | { readonly kind: 'paid' | 'review'; readonly orderId: string }
  | {
      readonly kind: 'challenge';
      readonly orderId: string;
      readonly challengeId: string;
      /** Geri sayimin son ani (deps.now saatinde); sunucu sure bildirmediyse undefined. */
      readonly deadline: number | undefined;
    }
  /** Secili kart artik yok: siparis odeme bekler, baska kartla yeniden verilir. */
  | { readonly kind: 'card-missing'; readonly held: HeldOrder }
  /**
   * Kapida odeme bu risk bandinda acik degil (422 PAYMENT_METHOD_NOT_ALLOWED; F12):
   * siparis TASLAKTA kalir, ayni siparis kartla verilir; cumle sunucunun.
   */
  | { readonly kind: 'method-refused'; readonly held: HeldOrder; readonly message: string };

export type CodeOutcome =
  | { readonly kind: 'paid' | 'review' }
  | { readonly kind: 'retry'; readonly message: string; readonly attemptsLeft: number };

export type ReleaseOutcome = 'released' | 'paid' | 'open';

const attemptsDetailsSchema = z.object({ attemptsLeft: z.number().int().min(0) });

/** Siparis 404'unun ayrintisi: kayitli kart kasada yok (silinmis ya da baskasinin). */
const cardMissingDetailsSchema = z.object({ resource: z.literal('card') });

const isCode = (error: unknown, code: string): error is AppError =>
  error instanceof AppError && error.code === code;

const isCardMissing = (error: unknown): boolean =>
  isCode(error, ERROR_CODES.NOT_FOUND) && cardMissingDetailsSchema.safeParse(error.details).success;

/** Kesin sonuc: niyet biter (sonraki rezervasyon yeni anahtarla); belirsizse korunur. */
function settleIntent(deps: OrderFlowDeps, error?: unknown): void {
  if (error === undefined || !isUnknownOutcome(error)) {
    deps.reserveIntent.renew();
  }
}

/**
 * Rezervasyon (niyet anahtariyla). Hatada niyet kesin sonucta yenilenir,
 * belirsizde korunur. Erken rezervasyon (odeme sayfasi acilinca) ve "Sipariş
 * Ver"in yedek yolu ayni fonksiyonu kullanir.
 */
export async function reserveOrder(
  deps: OrderFlowDeps,
  request: ReserveCartRequest,
): Promise<HeldOrder> {
  let reservation;
  try {
    reservation = await reserveCart(deps.client, request, deps.reserveIntent.key(request));
  } catch (error) {
    settleIntent(deps, error);
    throw error;
  }
  return {
    orderId: reservation.orderId,
    fingerprint: heldFingerprint(request),
    reservationReceivedAt: deps.now(),
    reservationTtlSeconds: reservation.ttlSeconds,
  };
}

/** Rezervasyon, sonra siparis (placeReserved): erken rezervasyon yoksa ya da gecersizse. */
export async function startOrder(
  deps: OrderFlowDeps,
  request: ReserveCartRequest,
  orderBody: (orderId: string) => CreateOrderRequest,
): Promise<PlaceOutcome> {
  return placeReserved(deps, await reserveOrder(deps, request), orderBody);
}

/**
 * Rezervasyonu alinmis siparis: ilk deneme ya da kart 404'unden sonra baska
 * kartla (PM K2). 3DS istenirse geri sayimin son ani kurulur (rezervasyonun ve
 * kodun sunucu sureleri); niyet 3DS bitene kadar surer. RISK_REVIEW (202)
 * siparis olustu ama incelemede demektir (N3): hata degil. Hatalar:
 *   - kart 404 (resource "card"): siparis TUTULUR; rezervasyon ve niyet korunur;
 *   - kapida odeme reddi (422; F12): siparis taslakta TUTULUR, kartla verilir;
 *   - belirsiz (503, REQUEST_IN_PROGRESS): hicbir sey birakilmaz, ayni anahtarlar;
 *   - kesin (diger): rezervasyon en iyi cabayla birakilir, niyet yenilenir
 *     (her denemede yeni stok kilidi acilmasin).
 * Govde kurulamazsa (form gecersiz) rezervasyon birakilir (QA K9 dusuk not).
 */
export async function placeReserved(
  deps: OrderFlowDeps,
  held: HeldOrder,
  orderBody: (orderId: string) => CreateOrderRequest,
): Promise<PlaceOutcome> {
  let body;
  try {
    body = orderBody(held.orderId);
  } catch (error) {
    await releaseSafely(deps, held.orderId);
    throw error;
  }
  let placement;
  try {
    placement = await placeOrder(deps.client, body, deps.orderAttempts.start());
    deps.orderAttempts.settle();
  } catch (error) {
    deps.orderAttempts.settle(error);
    if (isCode(error, ERROR_CODES.RISK_REVIEW)) {
      settleIntent(deps);
      return { kind: 'review', orderId: held.orderId };
    }
    if (isCardMissing(error)) {
      return { kind: 'card-missing', held };
    }
    if (
      isCode(error, ERROR_CODES.PAYMENT_METHOD_NOT_ALLOWED) &&
      body.payment.method === 'CASH_ON_DELIVERY'
    ) {
      return { kind: 'method-refused', held, message: error.message };
    }
    if (!isUnknownOutcome(error)) {
      await releaseSafely(deps, held.orderId);
    }
    throw error;
  }
  if (placement.threeDs !== undefined) {
    return {
      kind: 'challenge',
      orderId: placement.orderId,
      challengeId: placement.threeDs.challengeId,
      deadline: challengeDeadline({
        reservationReceivedAt: held.reservationReceivedAt,
        reservationTtlSeconds: held.reservationTtlSeconds,
        challengeReceivedAt: deps.now(),
        challengeTtlSeconds: placement.threeDs.ttlSeconds,
      }),
    };
  }
  settleIntent(deps);
  return { kind: placement.status === 'PAID' ? 'paid' : 'review', orderId: placement.orderId };
}

/**
 * 3DS kodu. Yanlis kodda (402 THREEDS_FAILED) hak kaldiysa tekrar: sunucunun
 * cumlesi ve kalan hak. Hak bittiyse ya da baska hata: firlatir.
 */
export async function submitCode(
  deps: OrderFlowDeps,
  orderId: string,
  challengeId: string,
  otp: string,
): Promise<CodeOutcome> {
  try {
    const placement = await confirmThreeDs(
      deps.client,
      orderId,
      { challengeId, otp },
      deps.newKey(),
    );
    settleIntent(deps);
    return { kind: placement.status === 'PAID' ? 'paid' : 'review' };
  } catch (error) {
    if (isCode(error, ERROR_CODES.THREEDS_FAILED)) {
      const details = attemptsDetailsSchema.safeParse(error.details);
      if (details.success && details.data.attemptsLeft > 0) {
        return { kind: 'retry', message: error.message, attemptsLeft: details.data.attemptsLeft };
      }
    }
    throw error;
  }
}

/**
 * Rezervasyonu en iyi cabayla birakir (Vazgeç, sure doldu, hak bitti). Hata
 * gostermez: 404 zaten yok; 409 REQUEST_IN_PROGRESS parasi alinmis olabilir:
 * siparis okunur, PAID ise basari akisi ("paid"); okunamazsa "open".
 * Birakma niyetin kesin sonudur: sonraki rezervasyon yeni anahtarla (QA K9 F1).
 */
export async function releaseSafely(deps: OrderFlowDeps, orderId: string): Promise<ReleaseOutcome> {
  deps.reserveIntent.renew();
  try {
    await releaseReservation(deps.client, orderId, deps.newKey());
    return 'released';
  } catch (error) {
    if (isCode(error, ERROR_CODES.NOT_FOUND)) {
      return 'released';
    }
    if (!isCode(error, ERROR_CODES.REQUEST_IN_PROGRESS)) {
      return 'open';
    }
    try {
      const order = await fetchOrder(deps.client, orderId);
      return order.status === 'PAID' ? 'paid' : 'open';
    } catch {
      return 'open';
    }
  }
}
