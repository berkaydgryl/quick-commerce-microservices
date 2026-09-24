/**
 * Risk degerlendirme kaydi (risk_events). Demodaki "bu siparis neden
 * engellendi?" sorusunun cevabi: skor, bant, veto veren kural ve her kuralin
 * sonucu.
 *
 * HAM BAGLAM TUTULMAZ (T6.3 karari): IP, konum ve cihaz kimligi kisisel
 * veridir ve denetim icin gerekmez; kural gerekceleri (T6.2) zaten kisisel
 * veri icermeden "neden"i anlatir.
 */

import { ID_PREFIX, newId } from '@getir/core';
import type { RiskBand } from '@getir/core';

import type { RiskContext } from './risk-context.js';
import type { RuleResult } from './rule.js';
import type { RiskAssessment } from './score.js';

export interface RiskEvent {
  readonly id: string;
  readonly userId: string;
  readonly orderId?: string;
  readonly marketId?: string;
  readonly score: number;
  readonly band: RiskBand;
  readonly vetoedByRuleId?: string;
  readonly hits: readonly RuleResult[];
  readonly evaluatedAt: Date;
}

/** Degerlendirmeden kayit: yalnizca kimlikler ve sonuc, sinyaller degil. */
export function toRiskEvent(
  context: RiskContext,
  assessment: RiskAssessment,
  evaluatedAt: Date,
): RiskEvent {
  return {
    id: newId(ID_PREFIX.RISK_EVENT),
    userId: context.userId,
    ...(context.orderId === undefined ? {} : { orderId: context.orderId }),
    ...(context.marketId === undefined ? {} : { marketId: context.marketId }),
    score: assessment.score,
    band: assessment.band,
    ...(assessment.vetoedByRuleId === undefined
      ? {}
      : { vetoedByRuleId: assessment.vetoedByRuleId }),
    hits: assessment.hits,
    evaluatedAt,
  };
}
