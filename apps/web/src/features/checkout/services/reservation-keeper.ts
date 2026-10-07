import type { CreateOrderRequest, ReserveCartRequest } from '@getir/contracts';

import { canReuseHeldOrder, heldMatchesBody } from './held-order';
import type { HeldOrder } from './held-order';
import { releaseSafely } from './place-order';
import type { OrderFlowDeps } from './place-order';
import { releasableOnLeave } from './reservation-plan';
import type { ReservationPhase } from './reservation-plan';

/**
 * Erken rezervasyonun fazini tutan nesne (React'siz; useEarlyReservation
 * sarar, siparis akisi paylasir). Kural: siparisi UCUSTAKI, sonucu belirsiz
 * ('placing') ya da VERILMIS ('ordered') rezervasyon ASLA birakilmaz (PM ek
 * sarti; QA K9 #178 F1: "Sipariş Ver" ile cevap arasinda sayfadan ayrilmak
 * rezervasyonu birakiyordu).
 */
export interface ReservationKeeper {
  readonly phase: () => ReservationPhase;
  readonly set: (next: ReservationPhase) => void;
  /**
   * "Sipariş Ver": bu istege ve govdeye uyan rezervasyon varsa 'placing'e
   * alinir ve verilir. Uymuyorsa (sure doldu, sepet degisti; kart 404'unden
   * tutulan sipariste yontem ya da ayrinti degisti, QA #176 N2) undefined:
   * siparisi verilmemisse birakilir, ucustaki ya da belirsizse BIRAKILMAZ.
   */
  readonly take: (
    request: ReserveCartRequest,
    orderBody: (orderId: string) => CreateOrderRequest,
  ) => Promise<HeldOrder | undefined>;
  /** Sayfadan ayrilinca: yalnizca siparisi verilmemis ('held') rezervasyon birakilir. */
  readonly leave: () => void;
}

export function createReservationKeeper(
  deps: OrderFlowDeps,
  onChange: (phase: ReservationPhase) => void,
): ReservationKeeper {
  let current: ReservationPhase = { kind: 'none' };
  const set = (next: ReservationPhase): void => {
    current = next;
    onChange(next);
  };
  return {
    phase: () => current,
    set,
    take: async (request, orderBody) => {
      const taken = current;
      if (taken.kind !== 'held' && taken.kind !== 'placing') {
        return undefined;
      }
      const usable =
        canReuseHeldOrder(taken.held, request, deps.now()) &&
        heldMatchesBody(taken.held, orderBody(taken.held.orderId));
      if (usable) {
        set({ kind: 'placing', held: taken.held });
        return taken.held;
      }
      set({ kind: 'none' });
      if (taken.kind === 'held') {
        await releaseSafely(deps, taken.held.orderId);
      }
      return undefined;
    },
    leave: () => {
      const leftOver = releasableOnLeave(current);
      if (leftOver !== undefined) {
        void releaseSafely(deps, leftOver.orderId);
      }
    },
  };
}
