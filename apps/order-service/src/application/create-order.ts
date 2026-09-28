/**
 * Use-case: siparis saga'si (T7.1) - taslagi odenmis siparise getirir.
 *
 *   DRAFT -> RISK_CHECK -> RESERVED -> AWAITING_PAYMENT -> PAID
 *                      \-> REVIEW / REJECTED        \-> PAYMENT_FAILED
 *
 * Adimlar: risk (risk-step.ts) ve odeme (payment-step.ts). Stok rezervasyonu
 * T11.2'de eklenir; o adim bugun kilitsiz gecer ve zaman cizelgesine
 * PENDING_RESERVATION notuyla yazilir.
 *
 * TEKRAR DENEME: siparis odeme adimina yazildiktan sonra cekim cevabi
 * kaybolursa (payment-svc'ye ulasilamadi) siparis AWAITING_PAYMENT kalir.
 * Ayni CreateOrder tekrar gelince risk yeniden sorulmaz; cekim siparisten
 * turetilen AYNI anahtarla tekrarlanir, payment-svc ikinci kez cekmez.
 */

import { ORDER_STATUS } from '@getir/core';
import type { Clock } from '@getir/core';

import type { CheckoutSignals } from '../domain/checkout-risk.js';
import type { OrderHistoryReader } from '../domain/order-history-reader.js';
import type { OrderOutbox } from '../domain/order-outbox.js';
import type { OrderRepository } from '../domain/order-repository.js';
import { findOwnOrder } from './own-order.js';
import { chargeOrder } from './payment-step.js';
import type { CheckoutResult, PaymentChoice } from './payment-step.js';
import type { Payments } from './payments.js';
import type { RequestScope } from './request-scope.js';
import type { RiskAssessment } from './risk-assessment.js';
import { passRiskStep } from './risk-step.js';

export interface CreateOrderDeps {
  readonly repository: OrderRepository;
  readonly history: Pick<OrderHistoryReader, 'riskHistory'>;
  readonly risk: RiskAssessment;
  readonly payments: Payments;
  /** Telafi komutu icin (payment-step.ts). */
  readonly outbox: Pick<OrderOutbox, 'append'>;
  readonly clock: Clock;
}

export interface CreateOrderInput extends PaymentChoice {
  readonly orderId: string;
  readonly userId: string;
  /**
   * Gateway'in bildigi risk sinyalleri (T7.5). Verilmezse sinyal yoktur (risk
   * sozlesmesi: eksik sinyal kurali tetiklemez). Yalnizca risk adiminda okunur;
   * tekrar denemede (AWAITING_PAYMENT) risk yeniden sorulmadigi icin kullanilmaz.
   */
  readonly signals?: CheckoutSignals | undefined;
}

export type CreateOrder = (input: CreateOrderInput, scope: RequestScope) => Promise<CheckoutResult>;

export function createCreateOrder(deps: CreateOrderDeps): CreateOrder {
  return async ({ orderId, userId, signals = {}, ...choice }, scope) => {
    const order = await findOwnOrder(deps.repository, orderId, userId);

    const awaitingPayment =
      order.status === ORDER_STATUS.AWAITING_PAYMENT
        ? order
        : await passRiskStep(deps, order, choice.method, signals, scope);

    return chargeOrder(deps, awaitingPayment, choice, scope);
  };
}
