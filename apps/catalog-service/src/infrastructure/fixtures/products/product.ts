/**
 * Ortak urun kurucusu: kimlik ve gorsel yolu SKU'dan turetilir (prd_<sku>,
 * /img/urun/<sku>.png). Gorsel dosyalari yayinda degildir (B3); web urun
 * kartinda kategorinin gorselini gosterir.
 */

import type { Product } from '../../../domain/catalog.js';

/** Urun kimligi SKU'dan: prd_ + kucuk harfli SKU (teklifler de bunu kullanir). */
export function productIdOf(sku: string): string {
  return `prd_${sku.toLowerCase()}`;
}

export function product(
  sku: string,
  name: string,
  description: string,
  categoryId: string,
  unit: Product['unit'],
): Product {
  const slug = sku.toLowerCase();
  return {
    id: productIdOf(sku),
    sku,
    name,
    description,
    categoryId,
    unit,
    imageUrl: `/img/urun/${slug}.png`,
  };
}
