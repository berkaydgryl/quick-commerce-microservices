/**
 * Use-case: taslak siparisi gercek siparise cevirir.
 *
 * KAPSAM (T3.2): taslak bulunur, sahiplik ve durum dogrulanir, siparis
 * AWAITING_PAYMENT'a gecer. Ikinci risk gecisi, odeme cekimi ve stok dusumu
 * (saga) T7.1'de; kalicilik T4.5'te gelecek.
 */

import { AppError, ORDER_STATUS } from '@getir/core';
import type { Clock } from '@getir/core';

import type { OrderRepository } from '../domain/order-repository.js';
import type { Order } from '../domain/order.js';
import { assertCanStartPayment, withStatus } from '../domain/order.js';

export interface CreateOrderDeps {
  readonly repository: OrderRepository;
  readonly clock: Clock;
}

export interface CreateOrderInput {
  readonly orderId: string;
  readonly userId: string;
}

export type CreateOrder = (input: CreateOrderInput) => Promise<Order>;

export function createCreateOrder(deps: CreateOrderDeps): CreateOrder {
  return async ({ orderId, userId }) => {
    const order = await deps.repository.findById(orderId);

    // SAHIPLIK KONTROLU (sozlesme yorumu): baskasinin siparisi icin
    // PERMISSION_DENIED DEGIL, NOT_FOUND doneriz - "bu kimlikte bir siparis
    // var" bilgisi bile sizdirilmamalidir.
    if (order === null || order.userId !== userId) {
      throw AppError.notFound('Siparis bulunamadi', { details: { orderId } });
    }

    assertCanStartPayment(order);

    const updated = withStatus(order, ORDER_STATUS.AWAITING_PAYMENT, deps.clock);
    await deps.repository.save(updated);
    return updated;
  };
}
