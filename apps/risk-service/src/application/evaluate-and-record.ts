/**
 * Evaluate RPC'nin use-case'i: motoru kostur, sonucu risk_events'e yaz, karari don.
 *
 * KAYIT YAZILAMAZSA KARAR YINE DONER (T6.3 karari): risk siparisin kritik
 * yolundadir ve sozlesme "risk yuzunden siparis akisinin durmasi kabul
 * edilemez" der. Kayip, mudahale gerektiren bir durum oldugu icin error
 * seviyesinde gunluge yazilir; bedeli o tek degerlendirmenin "neden" kaydinin
 * eksik kalmasidir.
 */

import type { Logger } from '@getir/core';

import type { RiskContext } from '../domain/risk-context.js';
import { toRiskEvent } from '../domain/risk-event.js';
import type { RiskEventRepository } from '../domain/risk-event-repository.js';
import type { EvaluateRisk, RiskEvaluation } from './evaluate-risk.js';

export interface EvaluateAndRecordDeps {
  readonly evaluateRisk: EvaluateRisk;
  readonly events: RiskEventRepository;
  readonly logger?: Logger;
}

export type EvaluateAndRecord = (context: RiskContext) => Promise<RiskEvaluation>;

export function createEvaluateAndRecord(deps: EvaluateAndRecordDeps): EvaluateAndRecord {
  return async (context) => {
    const evaluation = await deps.evaluateRisk(context);
    try {
      await deps.events.insert(toRiskEvent(context, evaluation, evaluation.evaluatedAt));
    } catch (error) {
      deps.logger?.error(
        { err: error, userId: context.userId, orderId: context.orderId, band: evaluation.band },
        'risk degerlendirmesi kaydedilemedi, karar yine donuldu',
      );
    }
    return evaluation;
  };
}
