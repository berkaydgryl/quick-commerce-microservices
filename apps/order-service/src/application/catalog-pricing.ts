/**
 * Catalog'dan fiyat okuma PORTU (T7.2). Uygulamasi infrastructure/catalog'da
 * (gRPC); testlerde sahtesi verilir.
 *
 * Hatalar AppError'dur: catalog'a ulasilamazsa ya da sure dolarsa
 * SERVICE_UNAVAILABLE, market yoksa NOT_FOUND.
 */

import type { MarketTerms } from '../domain/market-terms.js';
import type { CatalogOffer } from '../domain/price-draft.js';
import type { RequestScope } from './request-scope.js';

export interface CatalogPricing {
  /**
   * Marketin siparis kosullari: sepet kurallari (minimum sepet, teslimat ucreti,
   * ucretsiz esik) ve acik mi (#154). Kapali market BASARILI okumadir.
   */
  marketRules(marketId: string, scope: RequestScope): Promise<MarketTerms>;

  /**
   * Urunlerin o markette SATISTA olan teklifleri; TEK cagri (N+1 yok).
   * Satista olmayan ya da o markette bulunmayan urun listede YOKTUR.
   */
  activeOffers(
    marketId: string,
    productIds: readonly string[],
    scope: RequestScope,
  ): Promise<readonly CatalogOffer[]>;
}
