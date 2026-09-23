/**
 * Domain <-> Mongo belgesi cevirisi. Tek yer: alan adi degisirse tek dosya degisir.
 */

import type { Category, Market, Offer, Product } from '../../domain/catalog.js';
import { offerIdFor, searchTermsOf } from '../../domain/catalog.js';
import type { OfferSeed } from '../../domain/catalog-snapshot.js';
import type {
  CategoryDocument,
  MarketDocument,
  OfferDocument,
  ProductDocument,
} from './documents.js';

export function toCategoryDocument(category: Category): CategoryDocument {
  return {
    _id: category.id,
    name: category.name,
    slug: category.slug,
    sortOrder: category.sortOrder,
    imageUrl: category.imageUrl,
  };
}

export function fromCategoryDocument(document: CategoryDocument): Category {
  return {
    id: document._id,
    name: document.name,
    slug: document.slug,
    sortOrder: document.sortOrder,
    imageUrl: document.imageUrl,
  };
}

export function toProductDocument(product: Product): ProductDocument {
  return {
    _id: product.id,
    sku: product.sku,
    name: product.name,
    description: product.description,
    categoryId: product.categoryId,
    unit: product.unit,
    imageUrl: product.imageUrl,
  };
}

export function fromProductDocument(document: ProductDocument): Product {
  return {
    id: document._id,
    sku: document.sku,
    name: document.name,
    description: document.description,
    categoryId: document.categoryId,
    unit: document.unit,
    imageUrl: document.imageUrl,
  };
}

export function toMarketDocument(market: Market): MarketDocument {
  return {
    _id: market.id,
    name: market.name,
    brand: market.brand,
    logoUrl: market.logoUrl,
    location: { type: 'Point', coordinates: [market.lng, market.lat] },
    deliveryRadiusMeters: market.deliveryRadiusMeters,
    isOpen: market.isOpen,
    deliveryTime: { ...market.deliveryTime },
    rating: { ...market.rating },
    pricingRules: { ...market.pricingRules },
  };
}

export function fromMarketDocument(document: MarketDocument): Market {
  const [lng, lat] = document.location.coordinates;
  return {
    id: document._id,
    name: document.name,
    brand: document.brand,
    logoUrl: document.logoUrl,
    lat,
    lng,
    deliveryRadiusMeters: document.deliveryRadiusMeters,
    isOpen: document.isOpen,
    deliveryTime: { ...document.deliveryTime },
    rating: { ...document.rating },
    pricingRules: { ...document.pricingRules },
  };
}

/** Seed teklifini, urun kopyasi ve arama alanlariyla belgeye cevirir. */
export function toOfferDocument(seed: OfferSeed, product: Product): OfferDocument {
  return {
    _id: offerIdFor(seed.marketId, seed.productId),
    marketId: seed.marketId,
    productId: seed.productId,
    priceMinor: seed.priceMinor,
    isActive: seed.isActive,
    product: toProductDocument(product),
    categoryId: product.categoryId,
    searchTerms: [...searchTermsOf(product)],
  };
}

/** Sorgu yardimci alanlari (categoryId kopyasi, searchTerms) domain'e SIZMAZ. */
export function fromOfferDocument(document: OfferDocument): Offer {
  return {
    id: document._id,
    marketId: document.marketId,
    product: fromProductDocument(document.product),
    priceMinor: document.priceMinor,
    isActive: document.isActive,
  };
}
