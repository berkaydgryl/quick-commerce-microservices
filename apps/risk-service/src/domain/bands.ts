/**
 * Bant esikleri - TEK KAYNAK (proto yalnizca bandin ADINI tasir).
 *
 * T6.1 karari: 0-29 LOW, 30-54 MEDIUM, 55-79 HIGH, 80-100 CRITICAL. Eski
 * esiklerde (86+) agirliklar toplami tam 100 oldugu icin kritik banda ALTI
 * kuralin hepsi tetiklenmeden ulasilamiyordu. Kritik ayrica kesin kuralla
 * (veto) da gelir; o karar score.ts'tedir.
 */

import { RISK_BANDS } from '@getir/core';
import type { RiskBand } from '@getir/core';

/** Her bandin ALT siniri (dahil). LOW 0'dan baslar. */
export const BAND_LOWER_BOUNDS = {
  MEDIUM: 30,
  HIGH: 55,
  CRITICAL: 80,
} as const;

export const MIN_SCORE = 0;
export const MAX_SCORE = 100;

export function bandForScore(score: number): RiskBand {
  if (score >= BAND_LOWER_BOUNDS.CRITICAL) return RISK_BANDS.CRITICAL;
  if (score >= BAND_LOWER_BOUNDS.HIGH) return RISK_BANDS.HIGH;
  if (score >= BAND_LOWER_BOUNDS.MEDIUM) return RISK_BANDS.MEDIUM;
  return RISK_BANDS.LOW;
}
