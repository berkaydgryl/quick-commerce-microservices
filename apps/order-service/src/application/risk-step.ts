/**
 * Saga'nin risk adimi (T7.1): taslagi risk-svc'ye sorar ve karari yazar.
 *
 * Sira bilinclidir:
 *  1. Taslak mi? Degilse risk-svc'ye hic gidilmez (ORDER_STATE_INVALID).
 *  2. Degerlendirme. Ulasilamazsa hicbir sey yazilmaz: riski atlayarak odeme
 *     alinmaz, siparis DRAFT kalir, kullanici tekrar dener.
 *  3. Odeme yontemi YAZMADAN ONCE kontrol edilir: orta bantta kapida odeme
 *     secildiyse siparis DRAFT kalir ve kullanici kartla tekrar dener.
 *  4. Karar tek yazmayla (surum kontrollu) kaydedilir; durdurulan siparis
 *     (REVIEW, REJECTED) kaydedildikten SONRA hata doner.
 */

import { AppError, ORDER_STATUS } from '@getir/core';
import type { Clock } from '@getir/core';

import type { PaymentMethod } from '../domain/checkout-payment.js';
import {
  applyRiskDecision,
  assertPaymentMethodAllowed,
  decideRisk,
  riskContextOf,
} from '../domain/checkout-risk.js';
import { statusChangedEvents } from '../domain/order-events.js';
import type { OrderHistoryReader } from '../domain/order-history-reader.js';
import type { OrderRepository } from '../domain/order-repository.js';
import { assertTransition } from '../domain/order-state-machine.js';
import type { Order } from '../domain/order.js';
import type { RequestScope } from './request-scope.js';
import type { RiskAssessment } from './risk-assessment.js';

export interface RiskStepDeps {
  readonly repository: Pick<OrderRepository, 'update'>;
  readonly history: Pick<OrderHistoryReader, 'riskHistory'>;
  readonly risk: RiskAssessment;
  readonly clock: Clock;
}

/** @returns Odeme bekleyen (AWAITING_PAYMENT) siparis. */
export async function passRiskStep(
  deps: RiskStepDeps,
  order: Order,
  method: PaymentMethod,
  scope: RequestScope,
): Promise<Order> {
  assertTransition(order.id, order.status, ORDER_STATUS.RISK_CHECK);

  const history = await deps.history.riskHistory(order.userId);
  const evaluation = await deps.risk.evaluate(
    riskContextOf(order, history, deps.clock.date()),
    scope,
  );
  const decision = decideRisk(evaluation.band);
  if (decision.kind === 'proceed') {
    assertPaymentMethodAllowed(order.id, method, decision.policy);
  }

  const next = applyRiskDecision(order, evaluation.band, decision, deps.clock);
  await deps.repository.update(next, order.version, statusChangedEvents(order, next));
  scope.logger.info(
    { orderId: order.id, band: evaluation.band, score: evaluation.score, status: next.status },
    'risk adimi',
  );

  if (decision.kind === 'stop') {
    throw new AppError(decision.code, 'Siparis risk adiminda durduruldu', {
      details: { orderId: order.id, status: next.status },
    });
  }
  return next;
}
