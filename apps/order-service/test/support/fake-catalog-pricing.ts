/**
 * CatalogPricing portunun test sahtesi: sabit market kurallari ve teklifler.
 * Gelen requestId'leri kaydeder (iletim testi) ve istenirse hata firlatir.
 */

import { AppError } from '@getir/core';
import type { PricingRules } from '@getir/pricing';

import type { CatalogPricing } from '../../src/application/catalog-pricing.js';
import type { RequestScope } from '../../src/application/request-scope.js';
import { ITEM_UNIT } from '../../src/domain/order-item.js';
import type { CatalogOffer } from '../../src/domain/price-draft.js';

export const FAKE_MARKET_ID = 'mkt_migros-jet-moda';

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

  constructor(
    private readonly offers: readonly CatalogOffer[] = FAKE_OFFERS,
    private readonly rules: PricingRules = FAKE_RULES,
  ) {}

  marketRules(marketId: string, scope: RequestScope): Promise<PricingRules> {
    this.requestIds.push(scope.requestId);
    if (this.failure !== undefined) {
      return Promise.reject(this.failure);
    }
    if (marketId !== FAKE_MARKET_ID) {
      return Promise.reject(AppError.notFound('Market bulunamadi', { details: { marketId } }));
    }
    return Promise.resolve(this.rules);
  }

  activeOffers(
    marketId: string,
    productIds: readonly string[],
    scope: RequestScope,
  ): Promise<readonly CatalogOffer[]> {
    this.requestIds.push(scope.requestId);
    if (this.failure !== undefined) {
      return Promise.reject(this.failure);
    }
    return Promise.resolve(
      marketId === FAKE_MARKET_ID
        ? this.offers.filter((offer) => productIds.includes(offer.productId))
        : [],
    );
  }
}
