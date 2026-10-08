/**
 * Saga'nin durum yazimi: surum kontrollu gecis ve odenen siparisin PAID'i.
 * Odeme adimi (payment-step.ts) ve kilidi dusmus ama stogu kesinlesmis siparisi
 * tamamlayan kapatma (lapsed-order.ts, T15.3; bekleyen is 124) ayni yazimi kullanir.
 */

import { AppError, ERROR_CODES, ORDER_STATUS } from '@getir/core';
import type { Clock } from '@getir/core';

import { queuedForCourier } from '../domain/courier-dispatch.js';
import { statusChangedEvents } from '../domain/order-events.js';
import type { OrderEvent } from '../domain/order-events.js';
import type { OrderRepository } from '../domain/order-repository.js';
import type { Order } from '../domain/order.js';
import { transitionOrder } from '../domain/order.js';

export type TransitionRepository = Pick<OrderRepository, 'update' | 'findById'>;

/** Surum kontrollu yazimin sonucu; yazilamadiysa kaydin son hali ve cakisma hatasi. */
export type TransitionWrite =
  | { readonly written: true; readonly order: Order }
  | { readonly written: false; readonly latest: Order | null; readonly error: unknown };

/**
 * Surum kontrollu yazar; cakismada kaydin son halini okur (karar cagiranin).
 * `extraEvents` durum olaylarindan SONRA ayni yazima girer (ornegin iade komutu).
 */
export async function tryWriteTransition(
  repository: TransitionRepository,
  current: Order,
  next: Order,
  extraEvents: readonly OrderEvent[] = [],
): Promise<TransitionWrite> {
  try {
    await repository.update(next, current.version, [
      ...statusChangedEvents(current, next),
      ...extraEvents,
    ]);
    return { written: true, order: next };
  } catch (error) {
    if (!isConflict(error)) {
      throw error;
    }
    return { written: false, latest: await repository.findById(current.id), error };
  }
}

/**
 * Surum kontrollu yazar. Cakismada kayit tekrar okunur: zaten hedef durumdaysa
 * (ayni istegin es zamanli tekrari yazdi) o kayit doner; degilse CONFLICT.
 */
export async function writeTransition(
  repository: TransitionRepository,
  current: Order,
  next: Order,
): Promise<Order> {
  const write = await tryWriteTransition(repository, current, next);
  if (write.written) {
    return write.order;
  }
  if (write.latest?.status === next.status) {
    return write.latest;
  }
  throw write.error;
}

/**
 * Parasi alinmis, stogu kesinlesmis siparisin PAID hali. Kurye kuyruguna odeme
 * aniyla girer (#92): once odeyen once kurye alir.
 */
export function paidOrder(order: Order, clock: Clock, note: string | undefined): Order {
  return queuedForCourier(transitionOrder(order, ORDER_STATUS.PAID, clock, note));
}

/** Siparisi PAID yazar (writeTransition): cakismada siparis zaten PAID ise o kayit. */
export function writePaid(
  deps: { readonly repository: TransitionRepository; readonly clock: Clock },
  order: Order,
  note: string | undefined,
): Promise<Order> {
  return writeTransition(deps.repository, order, paidOrder(order, deps.clock, note));
}

export function isConflict(error: unknown): boolean {
  return error instanceof AppError && error.code === ERROR_CODES.CONFLICT;
}
