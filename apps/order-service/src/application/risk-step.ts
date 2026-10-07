/**
 * Saga'nin risk adimi (T7.1): taslagi risk-svc'ye sorar ve karari yazar.
 *
 * Sira bilinclidir:
 *  1. Taslak mi? Degilse risk-svc'ye hic gidilmez (ORDER_STATE_INVALID).
 *  2. Degerlendirme: order'in bildigi alanlar + gateway'in sinyalleri (T7.5).
 *     Ulasilamazsa hicbir sey yazilmaz: riski atlayarak odeme alinmaz,
 *     siparis DRAFT kalir, kullanici tekrar dener.
 *  3. Odeme yontemi YAZMADAN ONCE kontrol edilir: orta bantta kapida odeme
 *     secildiyse siparis DRAFT kalir ve kullanici kartla tekrar dener.
 *  4. Bant kilidi kisaltiyorsa (orta risk, T11.3) YAZMADAN ONCE inventory'de
 *     kisaltilir: inventory'ye ulasilamazsa hicbir sey yazilmaz, kilit dusmusse
 *     siparis CANCELLED + 410 (lock-timing.ts).
 *  5. Karar (ve kilidin yeni bitisi) tek yazmayla (surum kontrollu) kaydedilir;
 *     durdurulan siparis (REVIEW, REJECTED) kaydedildikten SONRA hata doner.
 *     Siparis ayrintilari ve odeme secimi (T12.4) ayni yazimda siparise girer;
 *     sozlesme onayinin ani bu adimin SUNUCU saatidir.
 */

import { AppError, ORDER_STATUS } from '@getir/core';

import {
  applyRiskDecision,
  assertPaymentMethodAllowed,
  decideRisk,
  riskContextOf,
} from '../domain/checkout-risk.js';
import type { CheckoutSignals } from '../domain/checkout-risk.js';
import { acceptDetails } from '../domain/order-details.js';
import type { OrderDetailsInput } from '../domain/order-details.js';
import type { OrderPayment } from '../domain/order-payment.js';
import { statusChangedEvents } from '../domain/order-events.js';
import type { OrderHistoryReader } from '../domain/order-history-reader.js';
import { assertTransition } from '../domain/order-state-machine.js';
import type { Order } from '../domain/order.js';
import { RELEASE_REASON } from '../domain/stock-reservation.js';
import { lockForBand } from './lock-timing.js';
import type { LockTimingDeps } from './lock-timing.js';
import type { RequestScope } from './request-scope.js';
import type { RiskAssessment } from './risk-assessment.js';
import { releaseStock } from './stock-step.js';

export interface RiskStepDeps extends LockTimingDeps {
  readonly history: Pick<OrderHistoryReader, 'riskHistory'>;
  readonly risk: RiskAssessment;
}

export interface RiskStepInput {
  /** Odeme secimi (T12.4): yontem ve kapida odemenin turu. */
  readonly payment: OrderPayment;
  readonly signals: CheckoutSignals;
  /** Siparise yazilacak ayrinti (T12.4); verilmezse siparis ayrintisiz kalir. */
  readonly details?: OrderDetailsInput | undefined;
}

/** @returns Odeme bekleyen (AWAITING_PAYMENT) siparis. */
export async function passRiskStep(
  deps: RiskStepDeps,
  order: Order,
  { payment, signals, details }: RiskStepInput,
  scope: RequestScope,
): Promise<Order> {
  assertTransition(order.id, order.status, ORDER_STATUS.RISK_CHECK);

  const history = await deps.history.riskHistory(order.userId);
  const evaluation = await deps.risk.evaluate(
    riskContextOf(order, history, deps.clock.date(), signals),
    scope,
  );
  const decision = decideRisk(evaluation.band);
  if (decision.kind === 'proceed') {
    assertPaymentMethodAllowed(order.id, payment.method, decision.policy);
  }
  const timed =
    decision.kind === 'proceed' ? await lockForBand(deps, order, evaluation.band, scope) : order;

  const decided = applyRiskDecision(timed, evaluation.band, decision, deps.clock);
  // Risk adimi yalnizca taslakta calisir: ayrinti ve odeme secimi ilk kez burada
  // yazilir. Secim yalnizca bant politikasi denetlenmisse (devam) yazilir; durdurulan
  // siparis (REVIEW, REJECTED) secimsiz kalir.
  const next = {
    ...decided,
    ...(decision.kind === 'proceed' ? { payment } : {}),
    ...(details === undefined ? {} : { details: acceptDetails(details, deps.clock) }),
  };
  await deps.repository.update(next, order.version, statusChangedEvents(order, next));
  scope.logger.info(
    { orderId: order.id, band: evaluation.band, score: evaluation.score, status: next.status },
    'risk adimi',
  );

  if (decision.kind === 'stop') {
    // Durdurulan siparisin stoku baskasina acilir (T7.1 notu, T11.2). Inceleme
    // onaylarsa stok yeniden kilitlenir (REVIEW -> RESERVED, inceleme akisi).
    await releaseStock(
      deps,
      next,
      next.status === ORDER_STATUS.REJECTED
        ? RELEASE_REASON.RISK_REJECTED
        : RELEASE_REASON.RISK_REVIEW,
      scope,
    );
    throw new AppError(decision.code, 'Siparis risk adiminda durduruldu', {
      details: { orderId: order.id, status: next.status },
    });
  }
  return next;
}
