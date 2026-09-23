/**
 * Depo okuma portu (bkz. category-reader.ts: neden ayri port).
 */

import type { StoreDistance } from './dark-store-resolution.js';
import type { GeoPoint } from './geo.js';

export interface DarkStoreReader {
  /** Depo katalogda tanimli mi? (Stok sorgusu DEGILDIR.) */
  darkStoreExists(darkStoreId: string): Promise<boolean>;
  /**
   * Konuma en yakin depolar, YAKINDAN UZAGA sirali, en fazla `limit` tane.
   * Acik/kapali ayrimi YAPMAZ: o karar domain'dedir (resolveDarkStore) ve
   * "kapali" sonucu icin kapali depolarin da gorulmesi gerekir.
   */
  listDarkStoresByDistance(point: GeoPoint, limit: number): Promise<readonly StoreDistance[]>;
}
