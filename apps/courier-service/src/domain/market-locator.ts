/**
 * Market konumu portu (T13.2). Market kaydinin sahibi catalog'dur (ADR-05);
 * kurye servisi havuz icin yalnizca konumun KOPYASINI tutar (markets
 * koleksiyonu, seed ve goc yazar). Katalogun demo verisiyle esitligi testli
 * (test/unit/courier-fixtures.spec.ts).
 */

import type { GeoPoint } from './courier.js';

export interface MarketLocation {
  /** mkt_ onekli kimlik (ADR-15). */
  readonly marketId: string;
  readonly location: GeoPoint;
}

export interface MarketLocator {
  /** Marketin konumu; kopyada yoksa null. */
  locate(marketId: string): Promise<GeoPoint | null>;
}
