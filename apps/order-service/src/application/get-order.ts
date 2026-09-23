/**
 * Use-case: tek siparis detayi (GetOrder), zaman cizelgesi dahil.
 */

import { AppError } from '@getir/core';

import type { OrderRepository } from '../domain/order-repository.js';
import type { Order } from '../domain/order.js';

export interface GetOrderDeps {
  readonly repository: Pick<OrderRepository, 'findById'>;
}

export interface GetOrderInput {
  readonly orderId: string;
  readonly userId: string;
}

export type GetOrder = (input: GetOrderInput) => Promise<Order>;

export function createGetOrder(deps: GetOrderDeps): GetOrder {
  return async ({ orderId, userId }) => {
    const order = await deps.repository.findById(orderId);

    // Baskasinin siparisi NOT_FOUND (sozlesme): "bu kimlikte siparis var"
    // bilgisi bile sizmasin - CreateOrder ve CancelOrder ile ayni kural.
    if (order === null || order.userId !== userId) {
      throw AppError.notFound('Siparis bulunamadi', { details: { orderId } });
    }
    return order;
  };
}
