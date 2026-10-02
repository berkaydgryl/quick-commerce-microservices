/**
 * GetPayment use-case: siparisin odeme kaydini okur (T11.2 PR 2).
 *
 * Cagiran order-svc'dir: odeme bekleyen siparisin kullanici iptalinde ve kilidi
 * dolan siparisi kapatan supurucuda "para alindi mi, cekim suruyor mu?" diye
 * sorar. Siparisin tek odemesi vardir; kayit siparis kimligiyle bulunur.
 */

import type { Payment } from '../domain/payment.js';
import type { PaymentRepository } from '../domain/payment-repository.js';
import { paymentNotFound } from '../domain/payment-repository.js';

export interface GetPaymentDeps {
  readonly repository: Pick<PaymentRepository, 'findByOrderId'>;
}

/** @throws AppError NOT_FOUND - o siparis icin hic cekim istenmedi. */
export type GetPayment = (orderId: string) => Promise<Payment>;

export function createGetPayment(deps: GetPaymentDeps): GetPayment {
  return async (orderId) => {
    const payment = await deps.repository.findByOrderId(orderId);
    if (payment === null) {
      throw paymentNotFound(orderId);
    }
    return payment;
  };
}
