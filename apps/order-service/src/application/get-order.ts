/**
 * Use-case: tek siparis detayi (GetOrder), zaman cizelgesi dahil.
 */

import type { OrderRepository } from '../domain/order-repository.js';
import type { Order } from '../domain/order.js';
import { findOwnOrder } from './own-order.js';

export interface GetOrderDeps {
  readonly repository: Pick<OrderRepository, 'findById'>;
}

export interface GetOrderInput {
  readonly orderId: string;
  readonly userId: string;
}

export type GetOrder = (input: GetOrderInput) => Promise<Order>;

export function createGetOrder(deps: GetOrderDeps): GetOrder {
  return ({ orderId, userId }) => findOwnOrder(deps.repository, orderId, userId);
}
