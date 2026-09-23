/**
 * Bellek deposu: T5.1'de tek depo, T5.3'ten sonra MOCK modu ve testler icin.
 * Mongo'daki iki unique indeksin (orderId, idempotencyKey) davranisini
 * birebir taklit eder; use-case iki depoda da ayni hatayi gorur.
 */

import type { Payment } from '../../domain/payment.js';
import type { PaymentRepository } from '../../domain/payment-repository.js';
import {
  paymentAlreadyExists,
  paymentNotFound,
  paymentVersionConflict,
} from '../../domain/payment-repository.js';

export class InMemoryPaymentStore implements PaymentRepository {
  /** orderId -> odeme. */
  private readonly payments = new Map<string, Payment>();

  insert(payment: Payment): Promise<void> {
    if (this.payments.has(payment.orderId) || this.hasKey(payment.idempotencyKey)) {
      return Promise.reject(paymentAlreadyExists(payment.orderId));
    }
    this.payments.set(payment.orderId, payment);
    return Promise.resolve();
  }

  update(payment: Payment, expectedVersion: number): Promise<void> {
    const current = this.payments.get(payment.orderId);
    if (current === undefined) {
      return Promise.reject(paymentNotFound(payment.orderId));
    }
    if (current.version !== expectedVersion) {
      return Promise.reject(paymentVersionConflict(payment.orderId, expectedVersion));
    }
    this.payments.set(payment.orderId, payment);
    return Promise.resolve();
  }

  findByOrderId(orderId: string): Promise<Payment | null> {
    return Promise.resolve(this.payments.get(orderId) ?? null);
  }

  findByIdempotencyKey(idempotencyKey: string): Promise<Payment | null> {
    for (const payment of this.payments.values()) {
      if (payment.idempotencyKey === idempotencyKey) {
        return Promise.resolve(payment);
      }
    }
    return Promise.resolve(null);
  }

  /** Yalnizca test icin: kac kayit var. */
  get size(): number {
    return this.payments.size;
  }

  private hasKey(idempotencyKey: string): boolean {
    return [...this.payments.values()].some((p) => p.idempotencyKey === idempotencyKey);
  }
}
