/** Domain <-> Mongo belgesi cevirisi. Tek yer: alan adi degisirse tek dosya degisir. */

import type { RuleResult } from '../../domain/rule.js';
import type { RiskEvent } from '../../domain/risk-event.js';
import type { RiskEventDocument, RuleResultDocument } from './documents.js';

const toRuleDocument = (hit: RuleResult): RuleResultDocument => ({ ...hit });

const fromRuleDocument = (document: RuleResultDocument): RuleResult => ({
  ruleId: document.ruleId,
  hit: document.hit,
  weight: document.weight,
  score: document.score,
  reason: document.reason,
  veto: document.veto,
});

export function toRiskEventDocument(event: RiskEvent): RiskEventDocument {
  return {
    _id: event.id,
    userId: event.userId,
    ...(event.orderId === undefined ? {} : { orderId: event.orderId }),
    ...(event.marketId === undefined ? {} : { marketId: event.marketId }),
    score: event.score,
    band: event.band,
    ...(event.vetoedByRuleId === undefined ? {} : { vetoedByRuleId: event.vetoedByRuleId }),
    rules: event.hits.map(toRuleDocument),
    createdAt: event.evaluatedAt,
  };
}

export function fromRiskEventDocument(document: RiskEventDocument): RiskEvent {
  return {
    id: document._id,
    userId: document.userId,
    ...(document.orderId === undefined ? {} : { orderId: document.orderId }),
    ...(document.marketId === undefined ? {} : { marketId: document.marketId }),
    score: document.score,
    band: document.band,
    ...(document.vetoedByRuleId === undefined ? {} : { vetoedByRuleId: document.vetoedByRuleId }),
    hits: document.rules.map(fromRuleDocument),
    evaluatedAt: document.createdAt,
  };
}
