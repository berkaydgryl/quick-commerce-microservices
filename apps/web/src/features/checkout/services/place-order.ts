/**
 * Siparis akisinin adimlari (T12.4). Arayuzden bagimsiz: istemci, saat ve
 * anahtarlar disaridan verilir (testte sahte istemci). Kararlar:
 *   - rezervasyon: niyet anahtari (ayni sepet + adres + tutar = ayni anahtar;
 *     belirsiz sonuc ayni rezervasyonu doner);
 *   - siparis: deneme anahtari (belirsiz sonucta korunur, cevap gelince yenilenir);
 *   - 3DS: her kod denemesi YENI anahtar (sozlesme kurali); kod sirdir:
 *     yalnizca istek govdesinde gider, saklanmaz;
 *   - birakma (PM karari N2 ve ek sart 1): her cagri yeni anahtar; 200 ve 404
 *     sessiz; 409 REQUEST_IN_PROGRESS "para alinmis olabilir": siparis okunur.
 */

import { AppError, ERROR_CODES } from '@getir/core';
import type { ReserveCartRequest } from '@getir/contracts';
import { z } from 'zod';

import type { HttpClient } from '../../../shared/api/http-client';
import type { AttemptKeys } from '../../cards/services/attempt-key';
import { fetchOrder } from '../../orders/api/orders.api';
import { confirmThreeDs, placeOrder, releaseReservation, reserveCart } from '../api/checkout.api';

import { challengeDeadline } from './countdown';
import type { PlaceOrderDraft } from './order-draft';

export interface OrderFlowDeps {
  readonly client: HttpClient;
  /** Monotonik saat (ms). */
  readonly now: () => number;
  /** Rezervasyonun niyet anahtari (createIntentKeys). */
  readonly reserveKey: (request: ReserveCartRequest) => string;
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
      /** Geri sayimin son ani (deps.now saatinde). */
      readonly deadline: number;
    };

export type CodeOutcome =
  | { readonly kind: 'paid' | 'review' }
  | { readonly kind: 'retry'; readonly message: string; readonly attemptsLeft: number };

export type ReleaseOutcome = 'released' | 'paid' | 'open';

const attemptsDetailsSchema = z.object({ attemptsLeft: z.number().int().min(0) });

const isCode = (error: unknown, code: string): error is AppError =>
  error instanceof AppError && error.code === code;

/**
 * Rezervasyon, sonra siparis. 3DS istenirse geri sayimin son ani kurulur
 * (rezervasyonun sunucu ttl'i ve kodun suresi). RISK_REVIEW (202) siparis
 * olustu ama incelemede demektir (N3): hata degil.
 */
export async function startOrder(
  deps: OrderFlowDeps,
  request: ReserveCartRequest,
  draft: (orderId: string) => PlaceOrderDraft,
): Promise<PlaceOutcome> {
  const reservation = await reserveCart(deps.client, request, deps.reserveKey(request));
  const reservationReceivedAt = deps.now();
  let placement;
  try {
    placement = await placeOrder(
      deps.client,
      draft(reservation.orderId),
      deps.orderAttempts.start(),
    );
    deps.orderAttempts.settle();
  } catch (error) {
    deps.orderAttempts.settle(error);
    if (isCode(error, ERROR_CODES.RISK_REVIEW)) {
      return { kind: 'review', orderId: reservation.orderId };
    }
    throw error;
  }
  if (placement.threeDs !== undefined) {
    return {
      kind: 'challenge',
      orderId: placement.orderId,
      challengeId: placement.threeDs.challengeId,
      deadline: challengeDeadline({
        reservationReceivedAt,
        reservationTtlSeconds: reservation.ttlSeconds,
        challengeReceivedAt: deps.now(),
      }),
    };
  }
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
 */
export async function releaseSafely(deps: OrderFlowDeps, orderId: string): Promise<ReleaseOutcome> {
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
