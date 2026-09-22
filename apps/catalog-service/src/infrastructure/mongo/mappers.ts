/**
 * Domain <-> Mongo belgesi cevirisi. Tek yer: alan adi degisirse tek dosya degisir.
 */

import type { Category, DarkStore, Product } from '../../domain/catalog.js';
import { searchTermsOf } from '../../domain/catalog.js';
import type { CategoryDocument, DarkStoreDocument, ProductDocument } from './documents.js';

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

/**
 * @param darkStoreIds Urunu satan depolar; domain Product'ta yoktur, cesit
 *                     tablosundan (CatalogSnapshot.assortment) gelir.
 */
export function toProductDocument(
  product: Product,
  darkStoreIds: readonly string[],
): ProductDocument {
  return {
    _id: product.id,
    sku: product.sku,
    name: product.name,
    description: product.description,
    priceMinor: product.priceMinor,
    categoryId: product.categoryId,
    unit: product.unit,
    imageUrl: product.imageUrl,
    isActive: product.isActive,
    darkStoreIds: [...darkStoreIds],
    searchTerms: [...searchTermsOf(product)],
  };
}

/** Sorgu yardimci alanlari (darkStoreIds, searchTerms) domain'e SIZMAZ. */
export function fromProductDocument(document: ProductDocument): Product {
  return {
    id: document._id,
    sku: document.sku,
    name: document.name,
    description: document.description,
    priceMinor: document.priceMinor,
    categoryId: document.categoryId,
    unit: document.unit,
    imageUrl: document.imageUrl,
    isActive: document.isActive,
  };
}

export function toDarkStoreDocument(store: DarkStore): DarkStoreDocument {
  return {
    _id: store.id,
    name: store.name,
    location: { type: 'Point', coordinates: [store.lng, store.lat] },
    deliveryRadiusMeters: store.deliveryRadiusMeters,
    isOpen: store.isOpen,
  };
}

export function fromDarkStoreDocument(document: DarkStoreDocument): DarkStore {
  const [lng, lat] = document.location.coordinates;
  return {
    id: document._id,
    name: document.name,
    lat,
    lng,
    deliveryRadiusMeters: document.deliveryRadiusMeters,
    isOpen: document.isOpen,
  };
}
