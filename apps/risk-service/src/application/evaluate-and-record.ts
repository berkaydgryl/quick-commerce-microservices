/**
 * Evaluate RPC'nin use-case'i: motoru kostur, sonucu risk_events'e yaz, karari don.
 *
 * KAYIT YAZILAMAZSA KARAR YINE DONER (T6.3 karari): risk siparisin kritik
 * yolundadir ve sozlesme "risk yuzunden siparis akisinin durmasi kabul
 * edilemez" der. Kayip, mudahale gerektiren bir durum oldugu icin error
 * seviyesinde gunluge yazilir; bedeli o tek degerlendirmenin "neden" kaydinin
 * eksik kalmasidir.
 *
 * KAYIT SURE SINIRLIDIR (#167): kayit en fazla `recordTimeoutMs` beklenir.
 * Mongo yavaslar ya da donarsa karar yine order'in risk butcesi (1 sn) icinde
 * doner; yoksa order SERVICE_UNAVAILABLE alir ve devre kesicisi (D17) acilabilir.
 * Sinir asilinca kayit BEKLENMEZ: WARN + `timed_out`; kayit arka planda surer.
 * Her kayit yazim BASLARKEN izlenir (PendingRecords; kapanis ucustaki her kaydi
 * gorur) ve sonucu bir kez bildirilir: sinir icinde yazildiysa `recorded`,
 * sonra yazildiysa `late`, dustu ya da kapanista yarim kaldiysa error +
 * `failed`. Sonuc olaylari kayit basina TEK: recorded | late | failed.
 *
 * Bu yuzden Evaluate dondugunde kayit yazilmis OLMAYABILIR (sinir asildiysa):
 * hemen ardindan GetLastEvaluation onceki degerlendirmeyi gorebilir.
 *
 * Arka plandaki isleyiciler ham baglami (IP, cihaz, koordinat) TUTMAZ: belge
 * baslangicta kurulur, isleyiciler yalnizca kimlik alanlarini tasir.
 */

import type { Logger } from '@getir/core';

import type { RiskContext } from '../domain/risk-context.js';
import { toRiskEvent } from '../domain/risk-event.js';
import type { RiskEventRepository } from '../domain/risk-event-repository.js';
import type { EvaluateRisk, RiskEvaluation } from './evaluate-risk.js';
import type { PendingRecords } from './pending-records.js';
import { TimeoutError, withTimeout } from './with-timeout.js';

/** Kaydin olaylari (metrik; kapali kume). `timed_out` ara olaydir, digerleri nihai sonuc. */
export const RECORD_EVENT = {
  RECORDED: 'recorded',
  TIMED_OUT: 'timed_out',
  LATE: 'late',
  FAILED: 'failed',
} as const;

export type RecordEvent = (typeof RECORD_EVENT)[keyof typeof RECORD_EVENT];

export interface EvaluateAndRecordDeps {
  readonly evaluateRisk: EvaluateRisk;
  readonly events: RiskEventRepository;
  /** Kaydin en fazla beklenecegi sure (ms; RISK_EVENT_RECORD_TIMEOUT_MS). */
  readonly recordTimeoutMs: number;
  /** Ucustaki kayitlar: her kayit yazim baslarken izlenir (kapanista sinirli beklenir). */
  readonly pending: PendingRecords;
  /** Kayit olayini bildirir (metrik); firlatsa da karar etkilenmez. */
  readonly onRecord?: (event: RecordEvent) => void;
}

/** `logger` CAGRININ gunlukcusudur (rpc + requestId bagli); motora da o gecer. */
export type EvaluateAndRecord = (context: RiskContext, logger: Logger) => Promise<RiskEvaluation>;

/** Arka plandaki isleyicilerin tasidigi her sey: kimlikler, gunlukcu, bildirim. */
interface RecordScope {
  readonly fields: { readonly userId: string; readonly orderId?: string; readonly band: string };
  readonly logger: Logger;
  readonly report: (event: RecordEvent) => void;
}

export function createEvaluateAndRecord(deps: EvaluateAndRecordDeps): EvaluateAndRecord {
  const report = (event: RecordEvent): void => {
    try {
      deps.onRecord?.(event);
    } catch {
      // Metrik kanali bozuk: karar ve kayit bundan etkilenmez.
    }
  };

  return async (context, logger) => {
    const evaluation = await deps.evaluateRisk(context, logger);
    const record = startRecord(deps.events, context, evaluation);
    const scope: RecordScope = {
      fields: {
        userId: context.userId,
        ...(context.orderId === undefined ? {} : { orderId: context.orderId }),
        band: evaluation.band,
      },
      logger,
      report,
    };
    // Karar HER durumda doner: kaydin bildirimi (gunluk) bile karari dusurmez.
    await settleRecord(record, deps, scope).catch(() => undefined);
    return evaluation;
  };
}

/** Kaydi baslatir; belge kurulurken senkron hata da reddedilen soz olur. */
function startRecord(
  events: RiskEventRepository,
  context: RiskContext,
  evaluation: RiskEvaluation,
): Promise<void> {
  try {
    return events.insert(toRiskEvent(context, evaluation, evaluation.evaluatedAt));
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Kaydin sonucunu BIR KEZ bildirir ve karari en fazla `recordTimeoutMs`
 * bekletir. Izleme yazim BASLARKEN kurulur (kapanis siniri dolmamis kaydi da
 * gorur); sinir asilinca once izleme kurulmus oldugu icin gunluk firlatsa da
 * kayit izlenir.
 */
async function settleRecord(
  record: Promise<void>,
  deps: Pick<EvaluateAndRecordDeps, 'recordTimeoutMs' | 'pending'>,
  scope: RecordScope,
): Promise<void> {
  let timedOut = false;
  let finished = false;
  const finish = (report: () => void): void => {
    if (!finished) {
      finished = true;
      report();
    }
  };
  deps.pending.watch(record, {
    onDone: () => finish(() => scope.report(timedOut ? RECORD_EVENT.LATE : RECORD_EVENT.RECORDED)),
    onLost: (reason) => finish(() => reportLost(scope, reason)),
  });
  try {
    await withTimeout(record, deps.recordTimeoutMs, 'risk degerlendirmesi kaydi');
  } catch (error) {
    // Kaydin kendi hatasi izlemede bildirilir; burada yalnizca sinir asimi.
    if (error instanceof TimeoutError && !finished) {
      timedOut = true;
      scope.report(RECORD_EVENT.TIMED_OUT);
      scope.logger.warn(
        { ...scope.fields, timeoutMs: deps.recordTimeoutMs },
        'risk kaydi sure sinirini asti; karar beklenmeden donuldu, kayit arka planda suruyor',
      );
    }
  }
}

function reportLost(scope: RecordScope, error: unknown): void {
  scope.report(RECORD_EVENT.FAILED);
  scope.logger.error(
    { err: error, ...scope.fields },
    'risk degerlendirmesi kaydedilemedi, karar yine donuldu',
  );
}
