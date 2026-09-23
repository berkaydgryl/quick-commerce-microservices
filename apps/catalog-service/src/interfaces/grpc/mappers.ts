/**
 * Domain -> sozlesme (proto) cevirisi.
 *
 * Bu katman olmasaydi domain, uretilen proto tiplerini kullanmak zorunda
 * kalirdi ve "domain disari bakmaz" kurali kagit uzerinde kalirdi. Ceviri tek
 * yerde: alan adi ya da enum degeri degisirse tek dosya degisir.
 */

import { commonV1 } from '@getir/proto';
import type { catalogV1 } from '@getir/proto';

import { DEFAULT_CURRENCY } from '../../config/constants.js';
import type { Category, Market, Offer, ProductUnit } from '../../domain/catalog.js';
import { PRODUCT_UNIT } from '../../domain/catalog.js';

/** Domain birimi -> proto enum. Eksik esleme derlemede yakalanir (Record). */
const UNIT_TO_PROTO: Readonly<Record<ProductUnit, commonV1.Unit>> = {
  [PRODUCT_UNIT.PIECE]: commonV1.Unit.UNIT_PIECE,
  [PRODUCT_UNIT.KILOGRAM]: commonV1.Unit.UNIT_KILOGRAM,
  [PRODUCT_UNIT.LITER]: commonV1.Unit.UNIT_LITER,
  [PRODUCT_UNIT.PACK]: commonV1.Unit.UNIT_PACK,
};

/** Kurus cinsinden TAM SAYI; bolme yalnizca gosterim aninda istemcide yapilir. */
function money(amountMinor: number): commonV1.Money {
  return { amountMinor, currency: DEFAULT_CURRENCY };
}

export function toProtoCategory(category: Category): catalogV1.Category {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    sortOrder: category.sortOrder,
    imageUrl: category.imageUrl,
  };
}

export function toProtoMarket(market: Market): catalogV1.Market {
  return {
    id: market.id,
    name: market.name,
    brand: market.brand,
    logoUrl: market.logoUrl,
    location: { lat: market.lat, lng: market.lng },
    deliveryRadiusMeters: market.deliveryRadiusMeters,
    isOpen: market.isOpen,
    deliveryTime: { ...market.deliveryTime },
    // Tam sayi tasinir (47 = 4.7); REST'e gateway cevirir.
    rating: { ...market.rating },
    pricingRules: {
      minBasket: money(market.pricingRules.minBasketMinor),
      deliveryFee: money(market.pricingRules.deliveryFeeMinor),
      freeDeliveryThreshold: money(market.pricingRules.freeDeliveryThresholdMinor),
    },
  };
}

export function toProtoOffer(offer: Offer): catalogV1.Offer {
  const { product } = offer;
  return {
    id: offer.id,
    marketId: offer.marketId,
    productId: product.id,
    sku: product.sku,
    name: product.name,
    description: product.description,
    categoryId: product.categoryId,
    unit: UNIT_TO_PROTO[product.unit],
    imageUrl: product.imageUrl,
    price: money(offer.priceMinor),
    isActive: offer.isActive,
  };
}
