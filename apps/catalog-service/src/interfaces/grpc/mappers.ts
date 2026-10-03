/**
 * Domain -> sozlesme (proto) cevirisi.
 *
 * Bu katman olmasaydi domain, uretilen proto tiplerini kullanmak zorunda
 * kalirdi ve "domain disari bakmaz" kurali kagit uzerinde kalirdi. Ceviri tek
 * yerde: alan adi ya da enum degeri degisirse tek dosya degisir.
 */

import { CURRENCY } from '@getir/core';
import { catalogV1, commonV1 } from '@getir/proto';

import type { Category, Market, Offer, ProductUnit, StoreType } from '../../domain/catalog.js';
import { PRODUCT_UNIT, STORE_TYPE } from '../../domain/catalog.js';
import type { MarketDistance } from '../../domain/market-coverage.js';
import type { NearbySearchResult } from '../../domain/nearby-search.js';
import type { OfferPage } from '../../domain/offer-reader.js';

/** Domain birimi -> proto enum. Eksik esleme derlemede yakalanir (Record). */
const UNIT_TO_PROTO: Readonly<Record<ProductUnit, commonV1.Unit>> = {
  [PRODUCT_UNIT.PIECE]: commonV1.Unit.UNIT_PIECE,
  [PRODUCT_UNIT.KILOGRAM]: commonV1.Unit.UNIT_KILOGRAM,
  [PRODUCT_UNIT.LITER]: commonV1.Unit.UNIT_LITER,
  [PRODUCT_UNIT.PACK]: commonV1.Unit.UNIT_PACK,
};

/** Domain dukkan turu -> proto enum (T11.11). Eksik esleme derlemede yakalanir (Record). */
const STORE_TYPE_TO_PROTO: Readonly<Record<StoreType, catalogV1.StoreType>> = {
  [STORE_TYPE.MARKET]: catalogV1.StoreType.STORE_TYPE_MARKET,
  [STORE_TYPE.MANAV]: catalogV1.StoreType.STORE_TYPE_MANAV,
  [STORE_TYPE.KASAP]: catalogV1.StoreType.STORE_TYPE_KASAP,
  [STORE_TYPE.SARKUTERI]: catalogV1.StoreType.STORE_TYPE_SARKUTERI,
  [STORE_TYPE.KURUYEMIS]: catalogV1.StoreType.STORE_TYPE_KURUYEMIS,
  [STORE_TYPE.FIRIN]: catalogV1.StoreType.STORE_TYPE_FIRIN,
  [STORE_TYPE.PETSHOP]: catalogV1.StoreType.STORE_TYPE_PETSHOP,
  [STORE_TYPE.CICEKCI]: catalogV1.StoreType.STORE_TYPE_CICEKCI,
};

/**
 * Kurus cinsinden TAM SAYI; bolme yalnizca gosterim aninda istemcide yapilir.
 * Para birimi bos birakilmaz: common.proto'ya gore bosluk doldurma sorumlulugu
 * sunucudadir, istemci varsayim yapmak zorunda kalmasin.
 */
function money(amountMinor: number): commonV1.Money {
  return { amountMinor, currency: CURRENCY };
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
    storeType: STORE_TYPE_TO_PROTO[market.storeType],
    coverUrl: market.coverUrl,
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

/**
 * Mesafe proto'da int32 METRE: burada tam sayiya yuvarlanir. Yuvarlama yaricap
 * kuralini bozmaz - yaricap tam sayi oldugu icin mesafe <= yaricap ise
 * yuvarlanmis mesafe de <= yaricap (istemci "yaricap disi" market gormez).
 */
export function toProtoNearbyMarket(nearby: MarketDistance): catalogV1.NearbyMarket {
  return {
    market: toProtoMarket(nearby.market),
    distanceMeters: Math.round(nearby.distanceMeters),
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

export function toListProductsResponse(page: OfferPage): catalogV1.ListProductsResponse {
  return {
    // Deprecated alan (ADR-15): fiyatsiz urun listesi artik doldurulmaz.
    products: [],
    offers: page.items.map(toProtoOffer),
    page: { nextPageToken: page.nextPageToken, totalSize: page.totalSize },
  };
}

/** Genel arama sonucu (T9.6): market ve mesafe, ad eslesmesi, ilk teklifler, toplam. */
export function toProtoMarketSearchResult(
  result: NearbySearchResult,
): catalogV1.MarketSearchResult {
  return {
    market: toProtoNearbyMarket(result.market),
    marketNameMatched: result.marketNameMatched,
    offers: result.offers.map(toProtoOffer),
    totalOfferMatches: result.totalOfferMatches,
  };
}
