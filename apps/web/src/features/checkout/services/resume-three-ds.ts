/**
 * 3DS'i yenilemede surdurme karari (F15b, #163). Saf: siparis cevabi ya da
 * hata -> ne yapilacagi. Kalan hak HER ZAMAN sunucudan (PM sart 1): istemci
 * sayaci sifirlamaz, varsayilan bir sayi koymaz. Kayittaki kimlik sunucunun
 * cevabiyla dogrulanir (sart 3): 404 (yok ya da baskasinin) ve uyusmayan
 * kimlik sessizce birakilir.
 *
 * AWAITING_PAYMENT anlam tablosu (#163 B1, sozlesme order-three-ds.ts):
 *   acik (challengeId, sure >= 1, hak >= 1) -> ayni pencere, kalan sure ve hak;
 *   kapali (jeton yok; sure ya da hak 0)    -> birak; metin sunucunun anlamiyla:
 *     hak 0 -> "hakkı bitti" (sure de dolmus olsa), aksi halde "süresi doldu";
 *   alan YOK (odeme gecici erisilemez)      -> BIRAKMA: yeniden dene, sonra uyari.
 */

import { ORDER_THREE_DS_STATE, isOpenOrderThreeDs, orderThreeDsState } from '@getir/contracts';
import type { CheckoutContent, Order, OrderStatus } from '@getir/contracts';
import { AppError, ERROR_CODES } from '@getir/core';

import { challengeDeadline } from './countdown';

export type ResumeDecision =
  | {
      readonly kind: 'challenge';
      readonly orderId: string;
      readonly challengeId: string;
      readonly deadline: number | undefined;
      /** Sunucunun kalan hakki (istemci sayi uydurmaz). */
      readonly attemptsLeft: number;
    }
  /** Dogrulama kapandi: siparis birakilir (PM S1 a); metin sebebe gore. */
  | {
      readonly kind: 'closed';
      readonly orderId: string;
      readonly reason: 'expired' | 'exhausted';
    }
  | { readonly kind: 'paid' | 'review'; readonly orderId: string }
  /** Surdurulecek bir sey yok: kayit silinir, sayfa normal. */
  | { readonly kind: 'gone' }
  /**
   * Bilinmiyor: odeme durumu okunamadi (threeDs alani yok ya da gecici hata).
   * Siparis BIRAKILMAZ, kayit kalir; yeniden denenir, sonra uyari.
   */
  | { readonly kind: 'unknown' };

/** Kapanan dogrulamanin bildirimi: hak bittiyse "hakkı bitti", aksi halde "süresi doldu". */
export const closedThreeDsNotice = (
  reason: 'expired' | 'exhausted',
  texts: Pick<CheckoutContent, 'threeDsExpiredToast' | 'threeDsExhaustedToast'>,
): string => (reason === 'exhausted' ? texts.threeDsExhaustedToast : texts.threeDsExpiredToast);

const PAID: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'PAID',
  'PREPARING',
  'ON_THE_WAY',
  'DELIVERED',
]);

export function resumeDecision(
  pendingId: string,
  result: { readonly order: Order } | { readonly error: unknown },
  now: number,
): ResumeDecision {
  if ('error' in result) {
    const missing = result.error instanceof AppError && result.error.code === ERROR_CODES.NOT_FOUND;
    return missing ? { kind: 'gone' } : { kind: 'unknown' };
  }
  const { order } = result;
  if (order.id !== pendingId) {
    return { kind: 'gone' };
  }
  if (PAID.has(order.status)) {
    return { kind: 'paid', orderId: order.id };
  }
  if (order.status === 'REVIEW') {
    return { kind: 'review', orderId: order.id };
  }
  if (order.status !== 'AWAITING_PAYMENT') {
    return { kind: 'gone' };
  }
  if (order.threeDs === undefined) {
    return { kind: 'unknown' };
  }
  if (!isOpenOrderThreeDs(order.threeDs)) {
    const exhausted = orderThreeDsState(order.threeDs) === ORDER_THREE_DS_STATE.EXHAUSTED;
    return { kind: 'closed', orderId: order.id, reason: exhausted ? 'exhausted' : 'expired' };
  }
  const { challengeId, ttlSeconds, attemptsLeft } = order.threeDs;
  return {
    kind: 'challenge',
    orderId: order.id,
    challengeId,
    deadline: challengeDeadline({
      reservationReceivedAt: now,
      reservationTtlSeconds: order.reservationTtlSeconds,
      challengeReceivedAt: now,
      challengeTtlSeconds: ttlSeconds,
    }),
    attemptsLeft,
  };
}

/** Bilinmeyen durumda (odeme okunamadi) yeniden deneme: 3 kez, 2 sn arayla (PM); sonra uyari. */
export const RESUME_RETRY_LIMIT = 3;
export const RESUME_RETRY_DELAY_MS = 2_000;

/** Karardan sonraki adim: uygula, yeniden dene ya da uyar (siparis BIRAKILMAZ). */
export function resumeNextStep(
  decision: ResumeDecision,
  retriesDone: number,
): 'apply' | 'retry' | 'fail' {
  if (decision.kind !== 'unknown') {
    return 'apply';
  }
  return retriesDone < RESUME_RETRY_LIMIT ? 'retry' : 'fail';
}
