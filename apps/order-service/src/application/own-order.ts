/**
 * Kullanicinin KENDI siparisini okur. Baskasinin siparisi PERMISSION_DENIED
 * degil NOT_FOUND'dur (sozlesme): "bu kimlikte bir siparis var" bilgisi bile
 * sizmamali. Kural GetOrder, CreateOrder, ConfirmPayment ve CancelOrder'da
 * aynidir; tek yerde durur.
 */

import { AppError } from '@getir/core';

import type { OrderRepository } from '../domain/order-repository.js';
import type { Order } from '../domain/order.js';

export async function findOwnOrder(
  repository: Pick<OrderRepository, 'findById'>,
  orderId: string,
  userId: string,
): Promise<Order> {
  const order = await repository.findById(orderId);
  if (order === null || order.userId !== userId) {
    throw AppError.notFound('Siparis bulunamadi', { details: { orderId } });
  }
  return order;
}
