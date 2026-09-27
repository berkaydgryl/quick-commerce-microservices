/**
 * risk-svc'ye degerlendirme PORTU (T7.1). Uygulamasi infrastructure/risk'te
 * (gRPC); testlerde sahtesi verilir.
 *
 * Hatalar AppError'dur: risk-svc'ye ulasilamazsa ya da sure dolarsa
 * SERVICE_UNAVAILABLE. Saga bu durumda siparise HIC yazmaz (riski atlayarak
 * odeme alinmaz); kullanici tekrar dener.
 */

import type { RiskBand } from '@getir/core';

import type { OrderRiskContext } from '../domain/checkout-risk.js';
import type { RequestScope } from './request-scope.js';

export interface RiskAssessmentResult {
  readonly band: RiskBand;
  /** 0-100 agirlikli skor; yalnizca gunluge yazilir, karar bantla verilir. */
  readonly score: number;
}

export interface RiskAssessment {
  evaluate(context: OrderRiskContext, scope: RequestScope): Promise<RiskAssessmentResult>;
}
