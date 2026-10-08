/**
 * CatalogPricing portunun test sahtesi: sabit market kurallari ve teklifler.
 * Gelen requestId'leri kaydeder (iletim testi) ve istenirse hata firlatir.
 */

import { AppError } from '@getir/core';
import type { PricingRules } from '@getir/pricing';

import type { CatalogPricing } from '../../src/application/catalog-pricing.js';
import type { RequestScope } from '../../src/application/request-scope.js';
import type { MarketTerms } from '../../src/domain/market-terms.js';
import { ITEM_UNIT } from '../../src/domain/order-item.js';
import type { CatalogOffer } from '../../src/domain/price-draft.js';

export const FAKE_MARKET_ID = 'mkt_migros-jet-moda';
/** Kapali seed marketi (#154); closedMarketIds'e eklenince taninir. */
export const CLOSED_MARKET_ID = 'mkt_a101-abbasaga';

/** Minimum sepet 50 TL, teslimat 14,90 TL, 250 TL ustu ucretsiz. */
export const FAKE_RULES: PricingRules = {
  minBasketMinor: 5_000,
  deliveryFeeMinor: 1_490,
  freeDeliveryThresholdMinor: 25_000,
};

export const FAKE_OFFERS: readonly CatalogOffer[] = [
  {
    productId: 'prd_01',
    sku: 'SUT-1L',
    name: 'Süt 1 L',
    unit: ITEM_UNIT.LITER,
    unitPriceMinor: 3_250,
    currency: 'TRY',
  },
  {
    productId: 'prd_02',
    sku: 'EKMEK-1',
    name: 'Ekmek',
    unit: ITEM_UNIT.PIECE,
    unitPriceMinor: 1_000,
    currency: 'TRY',
  },
];

export class FakeCatalogPricing implements CatalogPricing {
  /** Her cagrinin requestId'si, sirayla. */
  readonly requestIds: string[] = [];
  /** Verilirse her cagri bu hatayla reddedilir (catalog'a ulasilamadi vb.). */
  failure: AppError | undefined;
  /**
   * Kapali marketler (#154): okuma BASARILI, isOpen false, kurallar yok;
   * teklifleri gercekteki gibi DURUR. FAKE_MARKET_ID de eklenebilir.
   */
  readonly closedMarketIds = new Set<string>();
  /** Verilirse yalnizca teklif okumasi bu hatayla reddedilir. */
  offersFailure: AppError | undefined;

  constructor(
    private readonly offers: readonly CatalogOffer[] = FAKE_OFFERS,
    private readonly rules: PricingRules = FAKE_RULES,
  ) {}

  marketRules(marketId: string, scope: RequestScope): Promise<MarketTerms> {
    this.requestIds.push(scope.requestId);
    if (this.failure !== undefined) {
      return Promise.reject(this.failure);
    }
    const closed = this.closedMarketIds.has(marketId);
    if (marketId !== FAKE_MARKET_ID && !closed) {
      return Promise.reject(AppError.notFound('Market bulunamadi', { details: { marketId } }));
    }
    return Promise.resolve(closed ? { isOpen: false } : { isOpen: true, rules: this.rules });
  }

  activeOffers(
    marketId: string,
    productIds: readonly string[],
    scope: RequestScope,
  ): Promise<readonly CatalogOffer[]> {
    this.requestIds.push(scope.requestId);
    const failure = this.failure ?? this.offersFailure;
    if (failure !== undefined) {
      return Promise.reject(failure);
    }
    const known = marketId === FAKE_MARKET_ID || this.closedMarketIds.has(marketId);
    return Promise.resolve(
      known ? this.offers.filter((offer) => productIds.includes(offer.productId)) : [],
    );
  }
}
