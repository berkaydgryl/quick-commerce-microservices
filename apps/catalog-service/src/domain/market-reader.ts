/**
 * Market okuma portu (ADR-15). Uygulamalari infrastructure'dadir.
 */

import type { Market } from './catalog.js';
import type { GeoPoint } from './geo.js';
import type { MarketDistance } from './market-coverage.js';

export interface MarketReader {
  /** Yoksa null. */
  getMarket(marketId: string): Promise<Market | null>;
  marketExists(marketId: string): Promise<boolean>;
  /**
   * Konuma en yakin marketler, YAKINDAN UZAGA, en fazla `limit` tane.
   * Kapsama ve acik/kapali ayrimi YAPMAZ: o karar domain'dedir.
   */
  listMarketsByDistance(point: GeoPoint, limit: number): Promise<readonly MarketDistance[]>;
}
