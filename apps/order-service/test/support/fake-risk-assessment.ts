/**
 * Sahte risk servisi: bandi test belirler, gelen baglamlar kaydedilir.
 * Varsayilan LOW (kapida odeme acik, 3DS'siz): saga'nin mutlu yolu.
 */

import { RISK_BANDS } from '@getir/core';
import type { AppError, RiskBand } from '@getir/core';

import type {
  RiskAssessment,
  RiskAssessmentResult,
} from '../../src/application/risk-assessment.js';
import type { OrderRiskContext } from '../../src/domain/checkout-risk.js';

export class FakeRiskAssessment implements RiskAssessment {
  readonly contexts: OrderRiskContext[] = [];
  band: RiskBand = RISK_BANDS.LOW;
  score = 10;
  /** Doluysa degerlendirme bu hatayla basarisiz olur (orn. SERVICE_UNAVAILABLE). */
  failure: AppError | undefined;

  evaluate(context: OrderRiskContext): Promise<RiskAssessmentResult> {
    this.contexts.push(context);
    if (this.failure !== undefined) {
      return Promise.reject(this.failure);
    }
    return Promise.resolve({ band: this.band, score: this.score });
  }
}
