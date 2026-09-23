/**
 * Odeme deposu portu. Bugun bellek (T5.1); payments koleksiyonu T5.3'te ayni
 * arayuzun Mongo gerceklemesi olarak gelir (orderId ve idempotencyKey unique).
 */

import { AppError } from '@getir/core';

import type { Payment } from './payment.js';

export interface PaymentRepository {
  /** Siparisin odemesi ya da ayni anahtar zaten varsa CONFLICT firlatir. */
  insert(payment: Payment): Promise<void>;
  /** Var olan kaydi degistirir (durum gecisi). Kayit yoksa NOT_FOUND. */
  update(payment: Payment): Promise<void>;
  findByOrderId(orderId: string): Promise<Payment | null>;
  findByIdempotencyKey(idempotencyKey: string): Promise<Payment | null>;
}

export function paymentAlreadyExists(orderId: string): AppError {
  return AppError.conflict('Bu siparisin odemesi zaten var', { details: { orderId } });
}

export function paymentNotFound(orderId: string): AppError {
  return AppError.notFound('Odeme bulunamadi', { details: { orderId } });
}
