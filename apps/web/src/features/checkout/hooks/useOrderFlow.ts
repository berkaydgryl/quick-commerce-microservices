import type { CheckoutContent, CreateOrderRequest, ReserveCartRequest } from '@getir/contracts';
import { errorMessage } from '@getir/contracts';
import { AppError, ERROR_CODES } from '@getir/core';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router-dom';

import { createIdempotencyKey } from '../../../shared/api/idempotency-key';
import { authorizedClient } from '../../../shared/session/session';
import { useToastStore } from '../../../shared/toast/toast-store';
import { useCartStore } from '../../cart/stores/useCartStore';
import { cardKeys } from '../../cards/api/query-keys';
import { createAttemptKeys } from '../../cards/services/attempt-key';
import { marketKeys } from '../../markets/api/query-keys';
import { orderPath } from '../../orders/routes';
import { isUnknownOutcome } from '../../cards/services/attempt-key';
import { heldMatchesBody, orderBodyFingerprint } from '../services/held-order';
import type { HeldOrder } from '../services/held-order';
import { monotonicNow } from '../services/monotonic-clock';
import { placeReserved, releaseSafely, startOrder, submitCode } from '../services/place-order';
import type { OrderFlowDeps } from '../services/place-order';
import { createReserveIntent } from '../services/reserve-intent';

import { useEarlyReservation } from './useEarlyReservation';

export type OrderFlowState =
  | { readonly kind: 'idle' | 'busy' | 'done' }
  | {
      readonly kind: 'challenge';
      readonly orderId: string;
      readonly challengeId: string;
      readonly deadline: number | undefined;
      readonly verifying: boolean;
      /** Son yanlis kodun cumlesi ve kalan hak. */
      readonly failure?: { readonly message: string; readonly attemptsLeft: number } | undefined;
    };

type FlowTexts = Pick<
  CheckoutContent,
  | 'orderPlacedToast'
  | 'orderInReviewToast'
  | 'threeDsExpiredToast'
  | 'threeDsCancelledToast'
  | 'cardMissingNotice'
  | 'reservationRenewedToast'
>;

/** Kullaniciya gosterilecek cumle: gateway'in cumlesi (ERROR_MESSAGES) ya da genel hata. */
const userMessage = (error: unknown) =>
  error instanceof AppError ? error.message : errorMessage(ERROR_CODES.INTERNAL);

/**
 * Siparis akisinin durumu (T12.4): rezervasyon + siparis, 3DS penceresi,
 * basari (sepet bosalir, siparis detayina gidilir, bildirim), hata bildirimi.
 * useMutation DEGIL: mutasyon onbellegi degiskenleri (kisisel veri, 3DS kodu)
 * saklardi. Istek surerken ikinci basis yok (busy). PRICE_CHANGED'de marketin
 * kurallari yeniden cekilir: toplam tazelenir.
 *
 * Erken rezervasyon (PM K4; useEarlyReservation): odeme sayfasi acikken sepet
 * ayrilir, "Sipariş Ver" yalnizca siparisi verir; rezervasyon yoksa ya da bu
 * istege uymuyorsa eski yol (rezervasyon + siparis). Siparis verilen
 * rezervasyon ASLA birakilmaz.
 *
 * Kart 404'unde (secili kart artik yok) siparis TUTULUR (PM K2): bildirim,
 * kart listesi yeniden okunur; sonraki "Sipariş Ver" sepet, adres, tutar,
 * odeme yontemi ve ayrintilar ayniysa ve sure dolmadiysa ayni siparisi yeni
 * kartla verir; degilse tutulan rezervasyonu birakip yeniden alir (QA #176 N2).
 */
export function useOrderFlow(
  marketId: string | undefined,
  texts: FlowTexts,
  reservationRequest: ReserveCartRequest | undefined,
) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const clear = useCartStore((cart) => cart.clear);
  const show = useToastStore((toast) => toast.show);
  const [state, setState] = useState<OrderFlowState>({ kind: 'idle' });
  const [deps] = useState<OrderFlowDeps>(() => ({
    client: authorizedClient,
    now: monotonicNow,
    reserveIntent: createReserveIntent(),
    orderAttempts: createAttemptKeys(),
    newKey: createIdempotencyKey,
  }));
  const reservation = useEarlyReservation({
    deps,
    request: reservationRequest,
    active: state.kind === 'idle',
    onRenewed: () => show(texts.reservationRenewedToast),
  });

  const finish = (orderId: string, message: string) => {
    // 'done' sepet bosalmadan ISLENMELI: sepet deposu (useSyncExternalStore) senkron
    // seritte cizilir; durum ondan once islenmezse ekran bos sepeti gorup /sepet'e
    // donerdi (siparis detayindan sonra; canli testte bulundu).
    flushSync(() => setState({ kind: 'done' }));
    navigate(orderPath(orderId), { replace: true });
    clear();
    show(message);
  };

  const fail = (error: unknown, used: HeldOrder | undefined) => {
    if (used !== undefined && isUnknownOutcome(error)) {
      reservation.keep(used);
    } else {
      reservation.forget();
    }
    setState({ kind: 'idle' });
    show(userMessage(error));
    if (
      error instanceof AppError &&
      error.code === ERROR_CODES.PRICE_CHANGED &&
      marketId !== undefined
    ) {
      void queryClient.invalidateQueries({ queryKey: marketKeys.detail(marketId) });
    }
  };

  /** Pencere kapanir; rezervasyon birakilir (N2). Para alinmissa basari akisi. */
  const abandon = async (orderId: string, message: string) => {
    setState({ kind: 'busy' });
    const outcome = await releaseSafely(deps, orderId);
    if (outcome === 'paid') {
      finish(orderId, texts.orderPlacedToast);
      return;
    }
    reservation.forget();
    setState({ kind: 'idle' });
    show(message);
  };

  /**
   * Erken (ya da kart 404'unden tutulan) rezervasyon bu istege uyuyorsa yalnizca
   * siparis; siparis bir kez verildiyse yontem ve ayrintilar da ayni olmali
   * (QA #176 N2). Uymuyorsa birakilir ve rezervasyon + siparis bastan.
   */
  const placeWithReservation = async (
    request: ReserveCartRequest,
    orderBody: (orderId: string) => CreateOrderRequest,
  ) => {
    let held = await reservation.take(request);
    if (held !== undefined && !heldMatchesBody(held, orderBody(held.orderId))) {
      reservation.forget();
      await releaseSafely(deps, held.orderId);
      held = undefined;
    }
    const outcome = await (held === undefined
      ? startOrder(deps, request, orderBody)
      : placeReserved(deps, held, orderBody));
    return { outcome, used: held };
  };

  const place = async (
    request: ReserveCartRequest,
    orderBody: (orderId: string) => CreateOrderRequest,
  ) => {
    if (state.kind !== 'idle') return;
    setState({ kind: 'busy' });
    let used: HeldOrder | undefined;
    try {
      const result = await placeWithReservation(request, orderBody);
      used = result.used;
      const { outcome } = result;
      if (outcome.kind === 'card-missing') {
        reservation.keep({
          ...outcome.held,
          placedWith: orderBodyFingerprint(orderBody(outcome.held.orderId)),
        });
        setState({ kind: 'idle' });
        show(texts.cardMissingNotice);
        void queryClient.invalidateQueries({ queryKey: cardKeys.all });
        return;
      }
      reservation.ordered(outcome.orderId);
      if (outcome.kind === 'challenge') {
        setState({ ...outcome, verifying: false });
        return;
      }
      finish(
        outcome.orderId,
        outcome.kind === 'paid' ? texts.orderPlacedToast : texts.orderInReviewToast,
      );
    } catch (error) {
      fail(error, used);
    }
  };

  const submit = async (otp: string) => {
    if (state.kind !== 'challenge' || state.verifying) return;
    const { orderId, challengeId } = state;
    setState({ ...state, verifying: true });
    try {
      const outcome = await submitCode(deps, orderId, challengeId, otp);
      if (outcome.kind === 'retry') {
        setState((current) =>
          current.kind === 'challenge'
            ? {
                ...current,
                verifying: false,
                failure: { message: outcome.message, attemptsLeft: outcome.attemptsLeft },
              }
            : current,
        );
        return;
      }
      finish(orderId, outcome.kind === 'paid' ? texts.orderPlacedToast : texts.orderInReviewToast);
    } catch (error) {
      await abandon(orderId, userMessage(error));
    }
  };

  const cancel = () => {
    if (state.kind === 'challenge') void abandon(state.orderId, texts.threeDsCancelledToast);
  };

  const expire = () => {
    if (state.kind === 'challenge') void abandon(state.orderId, texts.threeDsExpiredToast);
  };

  return {
    state,
    place,
    submit,
    cancel,
    expire,
    reservation: { phase: reservation.phase, retry: reservation.retry },
  };
}
