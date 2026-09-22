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
import type { Category, Product, ProductUnit } from '../../domain/catalog.js';
import { PRODUCT_UNIT } from '../../domain/catalog.js';

/** Domain birimi -> proto enum. Eksik esleme derlemede yakalanir (Record). */
const UNIT_TO_PROTO: Readonly<Record<ProductUnit, commonV1.Unit>> = {
  [PRODUCT_UNIT.PIECE]: commonV1.Unit.UNIT_PIECE,
  [PRODUCT_UNIT.KILOGRAM]: commonV1.Unit.UNIT_KILOGRAM,
  [PRODUCT_UNIT.LITER]: commonV1.Unit.UNIT_LITER,
  [PRODUCT_UNIT.PACK]: commonV1.Unit.UNIT_PACK,
};

export function toProtoCategory(category: Category): catalogV1.Category {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    sortOrder: category.sortOrder,
    imageUrl: category.imageUrl,
  };
}

export function toProtoProduct(product: Product): catalogV1.Product {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    description: product.description,
    // Kurus cinsinden TAM SAYI; bolme yalnizca gosterim aninda istemcide yapilir.
    price: { amountMinor: product.priceMinor, currency: DEFAULT_CURRENCY },
    categoryId: product.categoryId,
    unit: UNIT_TO_PROTO[product.unit],
    imageUrl: product.imageUrl,
    isActive: product.isActive,
  };
}
