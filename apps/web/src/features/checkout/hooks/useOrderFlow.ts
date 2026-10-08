import type { CheckoutContent, CreateOrderRequest, ReserveCartRequest } from '@getir/contracts';
import { errorMessage } from '@getir/contracts';
import { AppError, ERROR_CODES } from '@getir/core';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router-dom';

import { createIdempotencyKey } from '../../../shared/api/idempotency-key';
import { authorizedClient } from '../../../shared/session/session';
import { useToastStore } from '../../../shared/toast/toast-store';
import { useCartStore } from '../../cart/stores/useCartStore';
import { cardKeys } from '../../cards/api/query-keys';
import { createAttemptKeys } from '../../cards/services/attempt-key';
import { marketKeys } from '../../markets/api/query-keys';
import { orderConfirmationPath } from '../../orders/routes';
import { confirmationState } from '../../orders/services/order-confirmation';
import type { ConfirmationHeading } from '../../orders/services/order-confirmation';
import { isUnknownOutcome } from '../../cards/services/attempt-key';
import { orderBodyFingerprint } from '../services/held-order';
import type { HeldOrder } from '../services/held-order';
import { monotonicNow } from '../services/monotonic-clock';
import type { ReservationPhase } from '../services/reservation-plan';
import { placeReserved, releaseSafely, reserveOrder, submitCode } from '../services/place-order';
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
  'threeDsExpiredToast' | 'threeDsCancelledToast' | 'cardMissingNotice' | 'reservationRenewedToast'
>;

interface OrderFlowOptions {
  /** Kapida odeme reddedildi (422; F12): sayfa secimi kaldirir, pencereyi acar. */
  readonly onMethodRefused?: (() => void) | undefined;
  /**
   * Kartla odeme bu pakette var mi (__CARD_VAULT__). Yoksa (production) 422'den
   * sonra kartla devam edilemez: taslak TUTULMAZ, birakilir (stok kilitli kalmasin).
   */
  readonly cardFallback?: boolean | undefined;
}

/** Tutulan ya da ucustaki siparisin kimligi (rezervasyon fazindan). */
const heldOrderId = (phase: ReservationPhase): string | undefined =>
  phase.kind === 'held' || phase.kind === 'placing' ? phase.held.orderId : undefined;

/** Kullaniciya gosterilecek cumle: gateway'in cumlesi (ERROR_MESSAGES) ya da genel hata. */
const userMessage = (error: unknown) =>
  error instanceof AppError ? error.message : errorMessage(ERROR_CODES.INTERNAL);

/**
 * Siparis akisinin durumu (T12.4): rezervasyon + siparis, 3DS penceresi,
 * basari (sepet bosalir, onay ekranina gidilir; F17: ekran onayi soyler,
 * bildirim yok), hata bildirimi.
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
 *
 * Kapida odeme orta risk bandinda reddedilirse (422; F12) siparis TASLAKTA
 * tutulur (yontem degisebilir: parmak izi yok), sunucunun cumlesi gosterilir;
 * bu siparis surdukce kapida odeme kapali (onDeliveryRefusal), sayfa kart
 * secer. Sonraki "Sipariş Ver" ayni siparisi kartla verir (yeni deneme anahtari).
 * Kart yoksa (kasasiz paket) taslak birakilir; yalniz cumle gosterilir.
 */
export function useOrderFlow(
  marketId: string | undefined,
  texts: FlowTexts,
  reservationRequest: ReserveCartRequest | undefined,
  options: OrderFlowOptions = {},
) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const clear = useCartStore((cart) => cart.clear);
  const show = useToastStore((toast) => toast.show);
  const [state, setState] = useState<OrderFlowState>({ kind: 'idle' });
  const [refusal, setRefusal] = useState<{ orderId: string; message: string } | undefined>();
  // Siparisin odendigi kart (F17 S4): onay ekrani kart listesinden "Visa •••• 4242" yazar.
  const paidCard = useRef<string | undefined>(undefined);
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

  const finish = (orderId: string, heading: ConfirmationHeading) => {
    // 'done' sepet bosalmadan ISLENMELI: sepet deposu (useSyncExternalStore) senkron
    // seritte cizilir; durum ondan once islenmezse ekran bos sepeti gorup /sepet'e
    // donerdi (canli testte bulundu). Adreste yalniz siparis kimligi; kart durumda.
    flushSync(() => setState({ kind: 'done' }));
    navigate(orderConfirmationPath(orderId), {
      replace: true,
      state: confirmationState(heading, paidCard.current),
    });
    clear();
  };

  const fail = (error: unknown, used: HeldOrder | undefined) => {
    if (used !== undefined && isUnknownOutcome(error)) {
      reservation.uncertain(used);
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
      finish(orderId, 'placed');
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
  const place = async (
    request: ReserveCartRequest,
    orderBody: (orderId: string) => CreateOrderRequest,
    /** Kartla odenecekse kartin kimligi (F17: onay ekrani "Visa •••• 4242" yazar). */
    paidCardId?: string,
  ) => {
    if (state.kind !== 'idle') return;
    setState({ kind: 'busy' });
    paidCard.current = paidCardId;
    let used: HeldOrder | undefined;
    try {
      // Rezervasyon siparis isteginden ONCE belli olur ve 'placing'e alinir:
      // istek ucustayken ya da sonucu belirsizken sayfadan ayrilmak onu birakmaz
      // (QA K9 #178 F1). Erken rezervasyon uymuyorsa ya da yoksa burada alinir.
      used = (await reservation.take(request, orderBody)) ?? (await reserveOrder(deps, request));
      reservation.uncertain(used);
      const outcome = await placeReserved(deps, used, orderBody);
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
      if (outcome.kind === 'method-refused' && options.cardFallback === false) {
        await releaseSafely(deps, outcome.held.orderId);
        reservation.forget();
        setState({ kind: 'idle' });
        show(outcome.message);
        return;
      }
      if (outcome.kind === 'method-refused') {
        reservation.keep(outcome.held);
        setRefusal({ orderId: outcome.held.orderId, message: outcome.message });
        setState({ kind: 'idle' });
        show(outcome.message);
        options.onMethodRefused?.();
        return;
      }
      reservation.ordered(outcome.orderId);
      if (outcome.kind === 'challenge') {
        setState({ ...outcome, verifying: false });
        return;
      }
      finish(outcome.orderId, outcome.kind === 'paid' ? 'placed' : 'review');
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
      finish(orderId, outcome.kind === 'paid' ? 'placed' : 'review');
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
    /**
     * Bu siparis icin kapida odeme reddedildiyse (422; F12) sunucunun cumlesi:
     * pencerede secenekler pasif ve not. Siparis degisince (yeni rezervasyon) kalkar.
     */
    onDeliveryRefusal:
      refusal !== undefined && heldOrderId(reservation.phase) === refusal.orderId
        ? refusal.message
        : undefined,
  };
}
