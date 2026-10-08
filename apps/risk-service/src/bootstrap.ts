/**
 * Bagimlilik kurulumu - elle (DI framework yok).
 */

import { systemClock } from '@getir/core';
import type { Clock, Logger } from '@getir/core';
import { riskV1 } from '@getir/proto';
import type { GrpcServiceRegistration } from '@getir/service-kit';

import { createEvaluateAndRecord } from './application/evaluate-and-record.js';
import { createEvaluateRisk } from './application/evaluate-risk.js';
import { createEvaluateWithRecentBand } from './application/evaluate-with-recent-band.js';
import { createReadRecentBand } from './application/read-recent-band.js';
import { createGetLastEvaluation } from './application/get-last-evaluation.js';
import type { PendingRecords } from './application/pending-records.js';
import {
  RECENT_BAND_READ_TIMEOUT_MS,
  RECENT_BAND_WINDOW_MS,
  RISK_EVENT_RECORD_TIMEOUT_MS,
  RISK_SERVICE_FULL_NAME,
  RULE_TIMEOUT_MS,
} from './config/constants.js';
import { riskRulesConfig } from './config/risk-rules.js';
import type { RecentRiskEvents, RiskEventRepository } from './domain/risk-event-repository.js';
import { InMemoryRiskEventStore } from './infrastructure/memory/in-memory-risk-event-store.js';
import {
  initRiskEventMetrics,
  recordRiskEvent,
} from './infrastructure/metrics/risk-event-metrics.js';
import { createRiskImplementation } from './interfaces/grpc/risk-handlers.js';
import { createCoreRules } from './rules/index.js';
import { createRuleRegistry } from './rules/registry.js';

export interface BootstrapOptions {
  readonly logger?: Logger;
  /**
   * risk_events deposu (kayit + yakin okuma, #164); main.ts openRiskEventStore'dan
   * verir. Verilmezse bellek (testler).
   */
  readonly events?: RiskEventRepository & RecentRiskEvents;
  /** Saat; testte sabitlenebilsin diye disaridan verilebilir. */
  readonly clock?: Clock;
  /** Kaydin sure siniri (ms); verilmezse RISK_EVENT_RECORD_TIMEOUT_MS (testte kisaltilir). */
  readonly recordTimeoutMs?: number;
  /**
   * Ucustaki kayitlar; ZORUNLU: main.ts kapanista ayni nesneyi bosaltir (drain).
   * Kurulumun kendi gizli kopyasi olsaydi kapanis kayitlari goremezdi.
   */
  readonly pendingRecords: PendingRecords;
}

export function buildRiskService(options: BootstrapOptions): GrpcServiceRegistration {
  const logger = options.logger;
  const clock = options.clock ?? systemClock;
  const events = options.events ?? new InMemoryRiskEventStore();

  // Kayit, kurallar ile config'i ACILISTA iki yonlu dogrular; uyusmazlik
  // servisi baslatmaz (sessizce puansiz kural kosmasindan iyidir).
  const rules = createRuleRegistry(createCoreRules(clock), riskRulesConfig);
  // Use-case'ler gunlukcuyu bagimlilik olarak ALMAZ: her cagrida handler'in
  // requestId bagli gunlukcusu gecer (ctx.logger).
  // Yapiskan bant (#164) motoru sarar; kayit yolu (evaluate-and-record) degismez.
  const evaluateRisk = createEvaluateWithRecentBand({
    evaluateRisk: createEvaluateRisk({ rules, clock, ruleTimeoutMs: RULE_TIMEOUT_MS }),
    readRecentBand: createReadRecentBand({
      events,
      clock,
      windowMs: RECENT_BAND_WINDOW_MS,
      readTimeoutMs: RECENT_BAND_READ_TIMEOUT_MS,
    }),
  });
  initRiskEventMetrics();

  return {
    name: RISK_SERVICE_FULL_NAME,
    definition: riskV1.RiskServiceService,
    implementation: createRiskImplementation({
      evaluate: createEvaluateAndRecord({
        evaluateRisk,
        events,
        recordTimeoutMs: options.recordTimeoutMs ?? RISK_EVENT_RECORD_TIMEOUT_MS,
        pending: options.pendingRecords,
        onRecord: recordRiskEvent,
      }),
      getLastEvaluation: createGetLastEvaluation(events),
      ...(logger === undefined ? {} : { logger }),
    }),
  };
}
