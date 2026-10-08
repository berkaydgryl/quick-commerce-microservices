import type { CheckoutContent, CreateOrderRequest, ReserveCartRequest } from '@getir/contracts';
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
import { createAttemptKeys, isUnknownOutcome } from '../../cards/services/attempt-key';
import { marketKeys } from '../../markets/api/query-keys';
import { orderConfirmationPath } from '../../orders/routes';
import { confirmationState } from '../../orders/services/order-confirmation';
import type { ConfirmationHeading } from '../../orders/services/order-confirmation';
import { orderBodyFingerprint } from '../services/held-order';
import { clearPendingThreeDs, savePendingThreeDs } from '../services/pending-three-ds';
import type { HeldOrder } from '../services/held-order';
import { monotonicNow } from '../services/monotonic-clock';
import { heldOrderId } from '../services/reservation-plan';
import { placeReserved, releaseSafely, reserveOrder, submitCode } from '../services/place-order';
import type { OrderFlowDeps } from '../services/place-order';
import { createReserveIntent } from '../services/reserve-intent';
import { closedThreeDsNotice } from '../services/resume-three-ds';
import { codeFailureNotice } from '../services/three-ds-code';
import { userMessage } from '../services/user-message';

import { useEarlyReservation } from './useEarlyReservation';
import { useRetryWait } from './useRetryWait';
import { useForgetPendingOnLeave, useThreeDsResume } from './useThreeDsResume';

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
      /** Yenilemede surdurulen 3DS'te sunucunun kalan hakki (F15b; istemci uydurmaz). */
      readonly attemptsLeft?: number | undefined;
    };

type FlowTexts = Pick<
  CheckoutContent,
  | 'threeDsExpiredToast'
  | 'threeDsExhaustedToast'
  | 'threeDsCancelledToast'
  | 'cardMissingNotice'
  | 'reservationRenewedToast'
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
  const [ownState, setState] = useState<OrderFlowState>({ kind: 'idle' });
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
  // Yenilemede bekleyen 3DS okunurken akis mesgul: yeni rezervasyon alinmaz (F15b).
  const resume = useThreeDsResume(deps, (decision) => {
    if (decision.kind === 'challenge') {
      reservation.ordered(decision.orderId);
      setState({ ...decision, verifying: false });
    } else if (decision.kind === 'closed') {
      void abandon(decision.orderId, closedThreeDsNotice(decision.reason, texts));
    } else {
      finish(decision.orderId, decision.kind === 'paid' ? 'placed' : 'review');
    }
  });
  // 429 (F15b): bekleme bitene kadar kod ve KARTLA "Sipariş Ver" kapali; kapida odeme serbest.
  const lock = useRetryWait();
  const blocked = resume.resuming || resume.failed;
  const state: OrderFlowState = blocked && ownState.kind === 'idle' ? { kind: 'busy' } : ownState;
  const reservation = useEarlyReservation({
    deps,
    request: reservationRequest,
    active: state.kind === 'idle',
    onRenewed: () => show(texts.reservationRenewedToast),
  });
  useForgetPendingOnLeave(state.kind === 'challenge');

  const finish = (orderId: string, heading: ConfirmationHeading) => {
    // 'done' sepet bosalmadan ISLENMELI: sepet deposu (useSyncExternalStore) senkron
    // seritte cizilir; durum ondan once islenmezse ekran bos sepeti gorup /sepet'e
    // donerdi (canli testte bulundu). Adreste yalniz siparis kimligi; kart durumda.
    flushSync(() => setState({ kind: 'done' }));
    clearPendingThreeDs();
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
    if (paidCard.current !== undefined && lock.start(error)) return;
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
    // Birakma sonucu belirsizse kayit KALIR: yenileme siparisi okuyup dogru sonuca gider.
    if (outcome === 'released') clearPendingThreeDs();
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
    if (state.kind !== 'idle' || (paidCardId !== undefined && lock.waitSeconds > 0)) return;
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
        // Yenilemede surdurmek icin yalniz siparis kimligi (F15b; kod ve challengeId yazilmaz).
        savePendingThreeDs(outcome.orderId);
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
      if (lock.start(error)) {
        // Kapi siparise gitmeden reddetti: dogrulama acik kalir, bekleme bitince kod girilir.
        setState((current) =>
          current.kind === 'challenge' ? { ...current, verifying: false } : current,
        );
        return;
      }
      await abandon(orderId, codeFailureNotice(error, texts));
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
    /** Yenilemede bekleyen 3DS okunamadi (F15b): uyari ve "Tekrar dene". */
    resume: { failed: resume.failed, retry: resume.retry },
    /** Cok fazla hatali kod (429): tekrar denemeye kalan saniye; yoksa 0. */
    waitSeconds: lock.waitSeconds,
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
