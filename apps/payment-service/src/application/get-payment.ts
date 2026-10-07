/**
 * GetPayment use-case: siparisin odeme kaydini okur (T11.2 PR 2).
 *
 * Cagiran order-svc'dir: odeme bekleyen siparisin kullanici iptalinde ve kilidi
 * dolan siparisi kapatan supurucuda "para alindi mi, cekim suruyor mu?" diye
 * sorar; siparis ayrintisinda da bekleyen 3DS dogrulamasinin durumunu (#163 B1).
 * Siparisin tek odemesi vardir; kayit siparis kimligiyle bulunur.
 */

import type { Clock } from '@getir/core';

import type { Payment } from '../domain/payment.js';
import type { PaymentRepository } from '../domain/payment-repository.js';
import { paymentNotFound } from '../domain/payment-repository.js';
import { threeDsViewOf } from '../domain/three-ds-view.js';
import type { ThreeDsView } from '../domain/three-ds-view.js';

export interface GetPaymentDeps {
  readonly repository: Pick<PaymentRepository, 'findByOrderId'>;
  readonly clock: Clock;
  /** 3DS'te en fazla yanlis kod hakki (THREEDS_MAX_ATTEMPTS). */
  readonly maxAttempts: number;
}

export interface PaymentRead {
  readonly payment: Payment;
  /** Bekleyen ya da kapanmis 3DS dogrulamasi; yoksa yok (three-ds-view.ts). */
  readonly threeDs?: ThreeDsView;
}

/** @throws AppError NOT_FOUND - o siparis icin hic cekim istenmedi. */
export type GetPayment = (orderId: string) => Promise<PaymentRead>;

export function createGetPayment(deps: GetPaymentDeps): GetPayment {
  return async (orderId) => {
    const payment = await deps.repository.findByOrderId(orderId);
    if (payment === null) {
      throw paymentNotFound(orderId);
    }
    const threeDs = threeDsViewOf(payment, deps.maxAttempts, deps.clock);
    return threeDs === undefined ? { payment } : { payment, threeDs };
  };
}
