/**
 * Refund use-case: tamamlanmis cekimi geri verir (mock iade, T7.1).
 *
 * Cagiran order-svc'nin saga'sidir: cekim basarili oldu ama siparis PAID
 * yazilamadi (ornegin kullanici ayni anda iptal etti) - para geri verilir.
 * Siparisin tek odemesi vardir, iade siparis kimligiyle bulunur.
 *
 * Es zamanli iki iade: ikisi de SUCCEEDED okur, biri yazar, digeri surum
 * cakismasi alir. Kaybeden kaydi tekrar okur; artik REFUNDED ise "zaten iade
 * edildi" doner - ayni para iki kez geri verilmez, hata da donmez.
 */

import { AppError, ERROR_CODES } from '@getir/core';
import type { Clock } from '@getir/core';

import type { Payment } from '../domain/payment.js';
import type { PaymentRepository } from '../domain/payment-repository.js';
import { paymentNotFound } from '../domain/payment-repository.js';
import { isRefunded, refundPayment } from '../domain/refund.js';

export interface RefundDeps {
  readonly repository: PaymentRepository;
  readonly clock: Clock;
}

export interface RefundInput {
  readonly orderId: string;
  /** Gerekce anahtari (ornek: order_cancelled); kayda oldugu gibi yazilir. */
  readonly reason: string;
}

export interface RefundResult {
  readonly payment: Payment;
  /** true: odeme bu cagridan ONCE iade edilmisti (tekrar istek). */
  readonly alreadyRefunded: boolean;
}

export type Refund = (input: RefundInput) => Promise<RefundResult>;

export function createRefund(deps: RefundDeps): Refund {
  return async ({ orderId, reason }) => {
    const payment = await load(deps.repository, orderId);
    if (isRefunded(payment)) {
      return { payment, alreadyRefunded: true };
    }

    const refunded = refundPayment(payment, reason, deps.clock);
    try {
      await deps.repository.update(refunded, payment.version);
      return { payment: refunded, alreadyRefunded: false };
    } catch (error) {
      if (!isVersionConflict(error)) {
        throw error;
      }
      const current = await load(deps.repository, orderId);
      if (isRefunded(current)) {
        return { payment: current, alreadyRefunded: true };
      }
      throw error;
    }
  };
}

async function load(repository: PaymentRepository, orderId: string): Promise<Payment> {
  const payment = await repository.findByOrderId(orderId);
  if (payment === null) {
    throw paymentNotFound(orderId);
  }
  return payment;
}

function isVersionConflict(error: unknown): boolean {
  return error instanceof AppError && error.code === ERROR_CODES.CONFLICT;
}
