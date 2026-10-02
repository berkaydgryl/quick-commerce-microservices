/**
 * Use-case: kullanici iptali (CancelOrder).
 *
 * Kullanici yalnizca DRAFT, RESERVED ve AWAITING_PAYMENT durumundaki kendi
 * siparisini iptal edebilir (USER_CANCELLABLE, B29). Odenmis siparisin iptali
 * sistemin telafi adimidir (iade, B20c); kullanici tetikleyemez.
 *
 * Iptalden sonra stok kilidi birakilir (T11.2, inventory Release): stok
 * baskasina acilir. Birakilamazsa kilit suresi dolunca inventory geri verir.
 * Odeme bekleyen siparisin odeme durumunu kontrol edip gerekirse iade etmek
 * T11.2 PR 2'de.
 */

import { AppError, ERROR_CODES, ORDER_STATUS } from '@getir/core';
import type { Clock } from '@getir/core';

import { statusChangedEvents } from '../domain/order-events.js';
import type { OrderRepository } from '../domain/order-repository.js';
import type { Order } from '../domain/order.js';
import { TIMELINE_NOTE, transitionOrder } from '../domain/order.js';
import { USER_CANCELLABLE } from '../domain/order-state-machine.js';
import { RELEASE_REASON } from '../domain/stock-reservation.js';
import { findOwnOrder } from './own-order.js';
import type { RequestScope } from './request-scope.js';
import { releaseStock } from './stock-step.js';
import type { StockStepDeps } from './stock-step.js';

export interface CancelOrderDeps extends StockStepDeps {
  readonly repository: OrderRepository;
  readonly clock: Clock;
}

export interface CancelOrderInput {
  readonly orderId: string;
  readonly userId: string;
  /** Gerekce ANAHTARI; verilmezse USER_CANCELLED. */
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

    const cancelled = transitionOrder(
      order,
      ORDER_STATUS.CANCELLED,
      deps.clock,
      reason ?? TIMELINE_NOTE.USER_CANCELLED,
    );
    await deps.repository.update(cancelled, order.version, statusChangedEvents(order, cancelled));
    await releaseStock(deps, order, RELEASE_REASON.USER_CANCELLED, scope);
    return cancelled;
  };
}
