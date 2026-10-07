import type { CreateOrderRequest, ReserveCartRequest } from '@getir/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import { heldExpiresAt, heldFingerprint } from '../services/held-order';
import type { HeldOrder } from '../services/held-order';
import { releaseSafely, reserveOrder } from '../services/place-order';
import type { OrderFlowDeps } from '../services/place-order';
import { createReservationKeeper } from '../services/reservation-keeper';
import { reservationStep } from '../services/reservation-plan';
import type { ReservationPhase, ReservationStep } from '../services/reservation-plan';

/** Degisiklikten sonra sakinlesme: adres ve tutar art arda degisirse tek istek. */
const SETTLE_MS = 400;
/** Son an gecince yeniden denemeden once pay (saat ve zamanlayici farki). */
const EXPIRY_MARGIN_MS = 50;

export interface EarlyReservation {
  readonly phase: ReservationPhase;
  /** Hata satirinin "Tekrar dene"si: rezervasyon yeniden denenir. */
  readonly retry: () => void;
  /**
   * "Sipariş Ver": istek suruyorsa bekler; bu istege ve govdeye uyan
   * rezervasyon varsa 'placing'e alip verir (ucustayken ayrilmak birakmaz).
   * Uymuyorsa undefined (reservation-keeper.ts).
   */
  readonly take: (
    request: ReserveCartRequest,
    orderBody: (orderId: string) => CreateOrderRequest,
  ) => Promise<HeldOrder | undefined>;
  /** Kart 404'u: siparis odemesiz bekler, rezervasyon tutulur (ayrilinca birakilabilir). */
  readonly keep: (held: HeldOrder) => void;
  /** Siparis istegi ucusta ya da sonucu belirsiz (503, REQUEST_IN_PROGRESS): BIRAKILMAZ, ayni rezervasyonla yeniden denenir. */
  readonly uncertain: (held: HeldOrder) => void;
  /** Siparis verildi (odendi, incelemede, 3DS suruyor): rezervasyon siparisin, ASLA birakilmaz. */
  readonly ordered: (orderId: string) => void;
  /** Rezervasyon akista birakildi ya da kullanilamaz: yeniden alinabilir. */
  readonly forget: () => void;
}

interface EarlyReservationInput {
  readonly deps: OrderFlowDeps;
  /** Rezervasyon istegi; kosullar saglanmiyorsa undefined (reservationRequestFor). */
  readonly request: ReserveCartRequest | undefined;
  /** Siparis akisi bosta mi: siparis surerken rezervasyona dokunulmaz. */
  readonly active: boolean;
  /** Suresi dolan rezervasyon sessizce yeniden alindi (bildirim). */
  readonly onRenewed: () => void;
}

/**
 * Erken rezervasyon (T12.4; PM K4): odeme sayfasi acikken sepet ayrilir;
 * "Sipariş Ver" yalnizca siparisi verir. Kurallar saf fonksiyonda
 * (reservation-plan.ts); bu hook istekleri, zamanlayiciyi ve ayrilinca
 * birakmayi isletir; faz reservation-keeper.ts'te. Siparisi verilmis, ucustaki
 * ya da sonucu belirsiz rezervasyon ASLA birakilmaz.
 */
export function useEarlyReservation({
  deps,
  request,
  active,
  onRenewed,
}: EarlyReservationInput): EarlyReservation {
  const [phase, setPhaseState] = useState<ReservationPhase>({ kind: 'none' });
  const [keeper] = useState(() => createReservationKeeper(deps, setPhaseState));
  const [expiryTick, setExpiryTick] = useState(0);
  const requestRef = useRef(request);
  const onRenewedRef = useRef(onRenewed);
  const inFlight = useRef<Promise<void> | undefined>(undefined);
  const mounted = useRef(true);
  const requestKey = request === undefined ? undefined : heldFingerprint(request);

  useEffect(() => {
    requestRef.current = request;
    onRenewedRef.current = onRenewed;
  });

  const setPhase = keeper.set;

  const reserve = useCallback(
    async (target: ReserveCartRequest, renewed: boolean) => {
      const fingerprint = heldFingerprint(target);
      setPhase({ kind: 'reserving', fingerprint });
      try {
        const held = await reserveOrder(deps, target);
        if (!mounted.current) {
          void releaseSafely(deps, held.orderId);
          return;
        }
        setPhase({ kind: 'held', held });
        if (renewed) {
          onRenewedRef.current();
        }
      } catch (error) {
        if (mounted.current) {
          setPhase({ kind: 'failed', fingerprint, error });
        }
      }
    },
    [deps, setPhase],
  );

  const run = useCallback(
    async (step: ReservationStep) => {
      const current = keeper.phase();
      if ((step === 'release' || step === 'replace') && current.kind === 'held') {
        setPhase({ kind: 'none' });
        await releaseSafely(deps, current.held.orderId);
      }
      if (step === 'renew') {
        // Suresi dolan rezervasyonun niyeti bitti: ayni anahtar eski (dolmus) cevabi dondururdu.
        deps.reserveIntent.renew();
      }
      const target = requestRef.current;
      if (step !== 'release' && target !== undefined) {
        await reserve(target, step === 'renew');
      }
    },
    [deps, keeper, reserve, setPhase],
  );

  useEffect(() => {
    if (!active) {
      return undefined;
    }
    const now = deps.now();
    const step = reservationStep(keeper.phase(), requestRef.current, now);
    if (step === 'wait') {
      const current = keeper.phase();
      const expiresAt = current.kind === 'held' ? heldExpiresAt(current.held) : undefined;
      if (expiresAt === undefined) {
        return undefined;
      }
      const timer = setTimeout(
        () => setExpiryTick((tick) => tick + 1),
        Math.max(0, expiresAt - now) + EXPIRY_MARGIN_MS,
      );
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(
      () => {
        inFlight.current = run(step).finally(() => {
          inFlight.current = undefined;
        });
      },
      step === 'renew' ? 0 : SETTLE_MS,
    );
    return () => clearTimeout(timer);
  }, [active, requestKey, phase, expiryTick, deps, keeper, run]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      keeper.leave();
    };
  }, [keeper]);

  const take = useCallback(
    async (target: ReserveCartRequest, orderBody: (orderId: string) => CreateOrderRequest) => {
      if (inFlight.current !== undefined) {
        await inFlight.current;
      }
      return keeper.take(target, orderBody);
    },
    [keeper],
  );

  return {
    phase,
    retry: useCallback(() => setPhase({ kind: 'none' }), [setPhase]),
    take,
    keep: useCallback((held: HeldOrder) => setPhase({ kind: 'held', held }), [setPhase]),
    uncertain: useCallback((held: HeldOrder) => setPhase({ kind: 'placing', held }), [setPhase]),
    ordered: useCallback((orderId: string) => setPhase({ kind: 'ordered', orderId }), [setPhase]),
    forget: useCallback(() => setPhase({ kind: 'none' }), [setPhase]),
  };
}
