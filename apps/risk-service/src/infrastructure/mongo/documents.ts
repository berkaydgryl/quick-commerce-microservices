/**
 * risk_events koleksiyonunun Mongo'daki SEKLI. Alan adlari roadmap "MongoDB
 * Veri Modeli" tablosuyla ayni (rules[], createdAt). Ham baglam (IP, konum,
 * cihaz) YOKTUR.
 */

import type { RiskBand } from '@getir/core';
import type { BaseDocument } from '@getir/mongo-kit';

export const COLLECTIONS = {
  RISK_EVENTS: 'risk_events',
} as const;

export interface RuleResultDocument {
  ruleId: string;
  hit: boolean;
  weight: number;
  score: number;
  reason: string;
  veto: boolean;
}

/** _id degerlendirme kimligidir (rev_...). Istege bagli alanlar yoksa HIC yazilmaz. */
export interface RiskEventDocument extends BaseDocument {
  userId: string;
  orderId?: string;
  marketId?: string;
  score: number;
  band: RiskBand;
  vetoedByRuleId?: string;
  rules: RuleResultDocument[];
  createdAt: Date;
}
