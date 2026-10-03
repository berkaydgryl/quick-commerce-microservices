/**
 * Use-case: kullanici iptali (CancelOrder).
 *
 * Kullanici yalnizca DRAFT, RESERVED ve AWAITING_PAYMENT durumundaki kendi
 * siparisini iptal edebilir (USER_CANCELLABLE, B29). Odenmis siparisin iptali
 * sistemin telafi adimidir (iade, B20c); kullanici tetikleyemez.
 *
 * Iptalden sonra stok kilidi birakilir (T11.2, inventory Release): stok
 * baskasina acilir. Birakilamazsa kilit suresi dolunca inventory geri verir.
 *
 * TASLAGI BIRAKMAK (T11.4, DELETE /v1/cart/reserve): gerekcesiz iptal edilen
 * DRAFT'in notu CART_RELEASED'dir; sepeti terk etmek siparis iptali degildir ve
 * risk gecmisinde sayilmaz. Odeme asamasindan iptal USER_CANCELLED (sayilir).
 *
 * ODEME BEKLEYEN siparis (T11.2 PR 2, karar 5a): once payment-svc'deki kayda
 * bakilir. Para alinmissa ya da kart cekimi suruyorsa iptal EDILMEZ
 * (REQUEST_IN_PROGRESS): saga siparisi tamamlar ya da kilit dolunca supurucu
 * iade eder. Boylece parasi alinmis siparisle kullanici iptali yarismaz.
 * payment-svc'ye ulasilamazsa iptal yapilmaz (SERVICE_UNAVAILABLE).
 */

import { AppError, ERROR_CODES, ORDER_STATUS } from '@getir/core';
import type { Clock } from '@getir/core';

import { statusChangedEvents } from '../domain/order-events.js';
import type { OrderRepository } from '../domain/order-repository.js';
import type { Order } from '../domain/order.js';
import { TIMELINE_NOTE, transitionOrder } from '../domain/order.js';
import { USER_CANCELLABLE } from '../domain/order-state-machine.js';
import { PAYMENT_STANDING, paymentStandingOf } from '../domain/payment-standing.js';
import { RELEASE_REASON } from '../domain/stock-reservation.js';
import { findOwnOrder } from './own-order.js';
import type { Payments } from './payments.js';
import type { RequestScope } from './request-scope.js';
import { releaseStock } from './stock-step.js';
import type { StockStepDeps } from './stock-step.js';

export interface CancelOrderDeps extends StockStepDeps {
  readonly repository: OrderRepository;
  /** Odeme bekleyen sipariste "para alindi mi?" sorusu (T11.2 PR 2). */
  readonly payments: Pick<Payments, 'getPayment'>;
  readonly clock: Clock;
}

export interface CancelOrderInput {
  readonly orderId: string;
  readonly userId: string;
  /** Gerekce ANAHTARI; verilmezse taslakta CART_RELEASED, digerlerinde USER_CANCELLED. */
  readonly reason?: string | undefined;
}

export type CancelOrder = (input: CancelOrderInput, scope: RequestScope) => Promise<Order>;

export function createCancelOrder(deps: CancelOrderDeps): CancelOrder {
  return async ({ orderId, userId, reason }, scope) => {
    const order = await findOwnOrder(deps.repository, orderId, userId);

    // Tabloda CANCELLED'a kenar olsa bile (PAID -> CANCELLED) kullanici
    // tetikleyemez: o kenar sistemin telafi adimidir.
    if (!USER_CANCELLABLE.has(order.status)) {
      throw new AppError(
        ERROR_CODES.ORDER_STATE_INVALID,
        `Bu durumdaki siparis iptal edilemez: ${order.status}`,
        {
          details: { orderId, status: order.status },
        },
      );
    }

    if (order.status === ORDER_STATUS.AWAITING_PAYMENT) {
      await assertNoPaymentTaken(deps, order, scope);
    }

    const releasesDraft = order.status === ORDER_STATUS.DRAFT && reason === undefined;
    const cancelled = transitionOrder(
      order,
      ORDER_STATUS.CANCELLED,
      deps.clock,
      reason ?? (releasesDraft ? TIMELINE_NOTE.CART_RELEASED : TIMELINE_NOTE.USER_CANCELLED),
    );
    await deps.repository.update(cancelled, order.version, statusChangedEvents(order, cancelled));
    await releaseStock(
      deps,
      order,
      releasesDraft ? RELEASE_REASON.CART_RELEASED : RELEASE_REASON.USER_CANCELLED,
      scope,
    );
    return cancelled;
  };
}

/**
 * @throws AppError REQUEST_IN_PROGRESS - para alindi ya da kart cekimi suruyor.
 * @throws AppError SERVICE_UNAVAILABLE - payment-svc'ye ulasilamadi (iptal yapilmaz).
 */
async function assertNoPaymentTaken(
  deps: CancelOrderDeps,
  order: Order,
  scope: RequestScope,
): Promise<void> {
  const payment = await deps.payments.getPayment(order.id, scope);
  if (payment === null || paymentStandingOf(payment) === PAYMENT_STANDING.NONE) {
    return;
  }
  throw new AppError(
    ERROR_CODES.REQUEST_IN_PROGRESS,
    'Odeme isleniyor; siparis tamamlaninca ya da suresi dolunca iade edilir',
    { details: { orderId: order.id, paymentStatus: payment.status } },
  );
}
