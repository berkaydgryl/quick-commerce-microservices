import type { CheckoutContent, CreateOrderRequest, ReserveCartRequest } from '@getir/contracts';
import { errorMessage } from '@getir/contracts';
import { AppError, ERROR_CODES } from '@getir/core';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
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
import { canReuseHeldOrder } from '../services/held-order';
import type { HeldOrder } from '../services/held-order';
import { placeReserved, releaseSafely, startOrder, submitCode } from '../services/place-order';
import type { OrderFlowDeps } from '../services/place-order';
import { createReserveIntent } from '../services/reserve-intent';

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
 * Kart 404'unde (secili kart artik yok) siparis TUTULUR (PM K2): bildirim,
 * kart listesi yeniden okunur; sonraki "Sipariş Ver" sepet, adres ve tutar
 * ayniysa ve sure dolmadiysa ayni siparisi yeni kartla verir, degilse tutulan
 * rezervasyonu birakip bastan baslar. Sayfadan ayrilinca tutulan rezervasyon
 * en iyi cabayla birakilir.
 */
export function useOrderFlow(marketId: string | undefined, texts: FlowTexts) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const clear = useCartStore((cart) => cart.clear);
  const show = useToastStore((toast) => toast.show);
  const [state, setState] = useState<OrderFlowState>({ kind: 'idle' });
  const [deps] = useState<OrderFlowDeps>(() => ({
    client: authorizedClient,
    now: () => performance.now(),
    reserveIntent: createReserveIntent(),
    orderAttempts: createAttemptKeys(),
    newKey: createIdempotencyKey,
  }));
  /** Kart 404'unden sonra tutulan siparis (yeniden cizim gerekmez: yalnizca sonraki basista okunur). */
  const held = useRef<HeldOrder | undefined>(undefined);

  useEffect(
    () => () => {
      const leftOver = held.current;
      if (leftOver !== undefined) {
        void releaseSafely(deps, leftOver.orderId);
      }
    },
    [deps],
  );

  const finish = (orderId: string, message: string) => {
    // 'done' sepet bosalmadan ISLENMELI: sepet deposu (useSyncExternalStore) senkron
    // seritte cizilir; durum ondan once islenmezse ekran bos sepeti gorup /sepet'e
    // donerdi (siparis detayindan sonra; canli testte bulundu).
    flushSync(() => setState({ kind: 'done' }));
    navigate(orderPath(orderId), { replace: true });
    clear();
    show(message);
  };

  const fail = (error: unknown) => {
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
    setState({ kind: 'idle' });
    show(message);
  };

  /** Tutulan siparis gecerliyse onu yeni kartla verir; degilse birakir ve bastan baslar. */
  const placeOrHeld = async (
    request: ReserveCartRequest,
    orderBody: (orderId: string) => CreateOrderRequest,
  ) => {
    const current = held.current;
    held.current = undefined;
    if (current !== undefined && canReuseHeldOrder(current, request, deps.now())) {
      return placeReserved(deps, current, orderBody);
    }
    if (current !== undefined) {
      await releaseSafely(deps, current.orderId);
    }
    return startOrder(deps, request, orderBody);
  };

  const place = async (
    request: ReserveCartRequest,
    orderBody: (orderId: string) => CreateOrderRequest,
  ) => {
    if (state.kind !== 'idle') return;
    setState({ kind: 'busy' });
    try {
      const outcome = await placeOrHeld(request, orderBody);
      if (outcome.kind === 'card-missing') {
        held.current = outcome.held;
        setState({ kind: 'idle' });
        show(texts.cardMissingNotice);
        void queryClient.invalidateQueries({ queryKey: cardKeys.all });
        return;
      }
      if (outcome.kind === 'challenge') {
        setState({ ...outcome, verifying: false });
        return;
      }
      finish(
        outcome.orderId,
        outcome.kind === 'paid' ? texts.orderPlacedToast : texts.orderInReviewToast,
      );
    } catch (error) {
      fail(error);
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

  return { state, place, submit, cancel, expire };
}
