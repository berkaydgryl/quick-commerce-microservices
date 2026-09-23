/**
 * Use-case: kullanici iptali (CancelOrder).
 *
 * Kullanici yalnizca DRAFT, RESERVED ve AWAITING_PAYMENT durumundaki kendi
 * siparisini iptal edebilir (USER_CANCELLABLE, B29). Odenmis siparisin iptali
 * sistemin telafi adimidir (iade, B20c); kullanici tetikleyemez.
 *
 * Rezervasyonun serbest birakilmasi (inventory Release) T11.2'de saga'ya
 * eklenecek; bugun siparis durumu ve zaman cizelgesi yazilir.
 */

import { AppError, ERROR_CODES, ORDER_STATUS } from '@getir/core';
import type { Clock } from '@getir/core';

import type { OrderRepository } from '../domain/order-repository.js';
import type { Order } from '../domain/order.js';
import { TIMELINE_NOTE, transitionOrder } from '../domain/order.js';
import { USER_CANCELLABLE } from '../domain/order-state-machine.js';

export interface CancelOrderDeps {
  readonly repository: OrderRepository;
  readonly clock: Clock;
}

export interface CancelOrderInput {
  readonly orderId: string;
  readonly userId: string;
  /** Gerekce ANAHTARI; verilmezse USER_CANCELLED. */
  readonly reason?: string | undefined;
}

export type CancelOrder = (input: CancelOrderInput) => Promise<Order>;

export function createCancelOrder(deps: CancelOrderDeps): CancelOrder {
  return async ({ orderId, userId, reason }) => {
    const order = await deps.repository.findById(orderId);

    // Baskasinin siparisi NOT_FOUND (varlik bilgisi sizmasin) - CreateOrder ile ayni kural.
    if (order === null || order.userId !== userId) {
      throw AppError.notFound('Siparis bulunamadi', { details: { orderId } });
    }

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
    await deps.repository.update(cancelled, order.version);
    return cancelled;
  };
}
