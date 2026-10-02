/**
 * Use-case: siparis saga'si (T7.1) - taslagi odenmis siparise getirir.
 *
 *   DRAFT -> RISK_CHECK -> RESERVED -> AWAITING_PAYMENT -> PAID
 *                      \-> REVIEW / REJECTED        \-> PAYMENT_FAILED
 *
 * Adimlar: risk (risk-step.ts) ve odeme (payment-step.ts). Stok taslak acilirken
 * kilitlenmistir (T11.2, draft-reservation.ts): kilidi dusmus taslak ilerlemez
 * (RESERVATION_EXPIRED), saga durursa kilit birakilir, odeme alininca kesinlesir.
 *
 * TEKRAR DENEME: siparis odeme adimina yazildiktan sonra cekim cevabi
 * kaybolursa (payment-svc'ye ulasilamadi) siparis AWAITING_PAYMENT kalir.
 * Ayni CreateOrder tekrar gelince risk yeniden sorulmaz; cekim siparisten
 * turetilen AYNI anahtarla tekrarlanir, payment-svc ikinci kez cekmez.
 */

import { AppError, ERROR_CODES, ORDER_STATUS } from '@getir/core';
import type { Clock } from '@getir/core';

import type { CheckoutSignals } from '../domain/checkout-risk.js';
import { statusChangedEvents } from '../domain/order-events.js';
import type { OrderHistoryReader } from '../domain/order-history-reader.js';
import type { OrderOutbox } from '../domain/order-outbox.js';
import type { OrderRepository } from '../domain/order-repository.js';
import type { Order } from '../domain/order.js';
import { transitionOrder } from '../domain/order.js';
import { hasLiveReservation, RELEASE_REASON } from '../domain/stock-reservation.js';
import { findOwnOrder } from './own-order.js';
import { chargeOrder } from './payment-step.js';
import type { CheckoutResult, PaymentChoice } from './payment-step.js';
import type { Payments } from './payments.js';
import type { RequestScope } from './request-scope.js';
import type { RiskAssessment } from './risk-assessment.js';
import { passRiskStep } from './risk-step.js';
import { releaseStock } from './stock-step.js';
import type { StockStepDeps } from './stock-step.js';

export interface CreateOrderDeps extends StockStepDeps {
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
    if (order.status === ORDER_STATUS.DRAFT && !hasLiveReservation(order, deps.clock.date())) {
      await expireDraft(deps, order, scope);
    }

    const awaitingPayment =
      order.status === ORDER_STATUS.AWAITING_PAYMENT
        ? order
        : await passRiskStep(deps, order, choice.method, signals, scope);

    return chargeOrder(deps, awaitingPayment, choice, scope);
  };
}

/**
 * Kilidi dusmus taslak (T11.2, karar "iptal + 410"): siparis CANCELLED olur,
 * kilit birakilir (supurucu birakmadiysa), istemci RESERVATION_EXPIRED alir ve
 * sepeti yeniden onaylar. Kilitsiz stokla odeme alinmaz.
 */
async function expireDraft(
  deps: CreateOrderDeps,
  order: Order,
  scope: RequestScope,
): Promise<never> {
  const cancelled = transitionOrder(
    order,
    ORDER_STATUS.CANCELLED,
    deps.clock,
    ERROR_CODES.RESERVATION_EXPIRED,
  );
  await deps.repository.update(cancelled, order.version, statusChangedEvents(order, cancelled));
  await releaseStock(deps, order, RELEASE_REASON.RESERVATION_EXPIRED, scope);
  throw new AppError(ERROR_CODES.RESERVATION_EXPIRED, 'Rezervasyon suresi doldu', {
    details: { orderId: order.id, status: ORDER_STATUS.CANCELLED },
  });
}
