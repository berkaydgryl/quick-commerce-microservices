/**
 * Bagimlilik kurulumu - elle (DI framework yok).
 */

import { systemClock } from '@getir/core';
import type { Clock, Logger } from '@getir/core';
import { riskV1 } from '@getir/proto';
import type { GrpcServiceRegistration } from '@getir/service-kit';

import { createEvaluateAndRecord } from './application/evaluate-and-record.js';
import { createEvaluateRisk } from './application/evaluate-risk.js';
import { createGetLastEvaluation } from './application/get-last-evaluation.js';
import { RISK_SERVICE_FULL_NAME, RULE_TIMEOUT_MS } from './config/constants.js';
import { riskRulesConfig } from './config/risk-rules.js';
import type { RiskEventRepository } from './domain/risk-event-repository.js';
import { InMemoryRiskEventStore } from './infrastructure/memory/in-memory-risk-event-store.js';
import { createRiskImplementation } from './interfaces/grpc/risk-handlers.js';
import { createCoreRules } from './rules/index.js';
import { createRuleRegistry } from './rules/registry.js';

export interface BootstrapOptions {
  readonly logger?: Logger;
  /** risk_events deposu; main.ts openRiskEventStore'dan verir. Verilmezse bellek (testler). */
  readonly events?: RiskEventRepository;
  /** Saat; testte sabitlenebilsin diye disaridan verilebilir. */
  readonly clock?: Clock;
}

export function buildRiskService(options: BootstrapOptions = {}): GrpcServiceRegistration {
  const logger = options.logger;
  const clock = options.clock ?? systemClock;
  const events = options.events ?? new InMemoryRiskEventStore();

  // Kayit, kurallar ile config'i ACILISTA iki yonlu dogrular; uyusmazlik
  // servisi baslatmaz (sessizce puansiz kural kosmasindan iyidir).
  const rules = createRuleRegistry(createCoreRules(clock), riskRulesConfig);
  const evaluateRisk = createEvaluateRisk({
    rules,
    clock,
    ruleTimeoutMs: RULE_TIMEOUT_MS,
    ...(logger === undefined ? {} : { logger }),
  });

  return {
    name: RISK_SERVICE_FULL_NAME,
    definition: riskV1.RiskServiceService,
    implementation: createRiskImplementation({
      evaluate: createEvaluateAndRecord({
        evaluateRisk,
        events,
        ...(logger === undefined ? {} : { logger }),
      }),
      getLastEvaluation: createGetLastEvaluation(events),
      ...(logger === undefined ? {} : { logger }),
    }),
  };
}
