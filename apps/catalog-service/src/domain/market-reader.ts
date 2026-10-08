/**
 * Market okuma portu (ADR-15). Uygulamalari infrastructure'dadir.
 */

import type { GeoPoint } from '@getir/core';

import type { Market } from './catalog.js';
import type { MarketDistance } from './market-coverage.js';

export interface MarketReader {
  /** Yoksa null. */
  getMarket(marketId: string): Promise<Market | null>;
  marketExists(marketId: string): Promise<boolean>;
  /** Verilen kimliklerdeki marketler (T11.13). SIRA GARANTISI YOKTUR; olmayan kimlik atlanir. */
  findMarketsByIds(marketIds: readonly string[]): Promise<readonly Market[]>;
  /**
   * Konumu KAPSAYAN marketler (teslim yaricapi icinde, sinir dahil; domain
   * coveringMarkets kurali), YAKINDAN UZAGA, en fazla `limit` tane. Kapali
   * marketler dahildir (acik/kapali karari domain'de). Sinir kapsamadan SONRA
   * uygulanir (#175): yakin ama kapsamayan marketler kapsayani gizlemez.
   */
  listCoveringMarkets(point: GeoPoint, limit: number): Promise<readonly MarketDistance[]>;
}
