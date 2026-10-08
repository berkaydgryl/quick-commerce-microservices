/**
 * Use-case: tek siparis detayi (GetOrder), zaman cizelgesi dahil. Odeme
 * bekleyen sipariste bekleyen 3DS dogrulamasi da doner (#163 B1,
 * pending-three-ds.ts).
 */

import type { OrderRepository } from '../domain/order-repository.js';
import type { Order } from '../domain/order.js';
import type { ThreeDsStatus } from '../domain/payment-three-ds.js';
import { findOwnOrder } from './own-order.js';
import { pendingThreeDs } from './pending-three-ds.js';
import type { Payments } from './payments.js';
import type { RequestScope } from './request-scope.js';

export interface GetOrderDeps {
  readonly repository: Pick<OrderRepository, 'findById'>;
  readonly payments: Pick<Payments, 'getThreeDs'>;
}

export interface GetOrderInput {
  readonly orderId: string;
  readonly userId: string;
}

/** Siparis ve (yalnizca AWAITING_PAYMENT'ta, biliniyorsa) 3DS durumu. */
export interface OrderView {
  readonly order: Order;
  readonly threeDs?: ThreeDsStatus;
}

export type GetOrder = (input: GetOrderInput, scope: RequestScope) => Promise<OrderView>;

export function createGetOrder(deps: GetOrderDeps): GetOrder {
  return async ({ orderId, userId }, scope) => {
    // Sahiplik ONCE: baskasinin siparisi NOT_FOUND ve payment'a hic gidilmez.
    const order = await findOwnOrder(deps.repository, orderId, userId);
    const threeDs = await pendingThreeDs(deps.payments, order, scope);
    return threeDs === undefined ? { order } : { order, threeDs };
  };
}
