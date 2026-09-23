/**
 * "Bu konuma hangi marketler hizmet verir?" kurali (saf) - ADR-15.
 *
 * Pazaryerinde sistem market ATAMAZ: konumu teslimat yaricapi icinde kalan
 * marketler listelenir, kullanici secer. Kapali marketler listede KALIR
 * (istemci "Kapali" rozeti gosterir); siparis kapisi rezervasyondadir.
 *
 * T4.2'nin "yaricap icinde ama kapali -> STORE_CLOSED / yaricap disi ->
 * OUT_OF_RANGE" ayrimi TEK market icin burada yasar (evaluateCoverage);
 * rezervasyon (T11.4) secilen marketin hala hizmet verip vermedigini buna sorar.
 */

import type { Market } from './catalog.js';

/** Bir marketin konuma uzakligi. */
export interface MarketDistance {
  readonly market: Market;
  /** Konum ile market arasi, metre (yuvarlanmamis). */
  readonly distanceMeters: number;
}

/** Tek bir marketin bir konuma hizmet durumu. */
export type CoverageStatus = 'serves' | 'closed' | 'out-of-range';

/**
 * @param candidate Market ve konuma uzakligi.
 *
 * Yaricap SINIRI dahildir (mesafe == yaricap hizmet verir).
 */
export function evaluateCoverage(candidate: MarketDistance): CoverageStatus {
  if (candidate.distanceMeters > candidate.market.deliveryRadiusMeters) {
    return 'out-of-range';
  }
  return candidate.market.isOpen ? 'serves' : 'closed';
}

/**
 * Konumu kapsayan marketler, YAKINDAN UZAGA. Kapali olanlar dahildir.
 *
 * @param candidates Marketler, yakindan uzaga sirali (repository boyle verir).
 */
export function coveringMarkets(candidates: readonly MarketDistance[]): readonly MarketDistance[] {
  return candidates.filter((candidate) => evaluateCoverage(candidate) !== 'out-of-range');
}
