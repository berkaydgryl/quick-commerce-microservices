/**
 * Demo verisi: platform kategorileri ve ORTAK urunler (fiyatsiz - ADR-15).
 * Bkz. ../fixtures.ts (tek giris noktasi ve gerekce).
 */

import type { Category, Product } from '../../domain/catalog.js';
import { PRODUCT_UNIT } from '../../domain/catalog.js';

export const CATEGORIES: readonly Category[] = [
  {
    id: 'cat_sut-kahvaltilik',
    name: 'Süt & Kahvaltılık',
    slug: 'sut-kahvaltilik',
    sortOrder: 1,
    imageUrl: '/img/cat/sut.png',
  },
  {
    id: 'cat_meyve-sebze',
    name: 'Meyve & Sebze',
    slug: 'meyve-sebze',
    sortOrder: 2,
    imageUrl: '/img/cat/manav.png',
  },
  {
    id: 'cat_icecek',
    name: 'İçecek',
    slug: 'icecek',
    sortOrder: 3,
    imageUrl: '/img/cat/icecek.png',
  },
  {
    id: 'cat_atistirmalik',
    name: 'Atıştırmalık',
    slug: 'atistirmalik',
    sortOrder: 4,
    imageUrl: '/img/cat/atistirmalik.png',
  },
  {
    id: 'cat_temizlik',
    name: 'Temizlik',
    slug: 'temizlik',
    sortOrder: 5,
    imageUrl: '/img/cat/temizlik.png',
  },
];

/** Ortak urunler: fiyat YOK - fiyat marketin teklifindedir (ADR-15). */
export const PRODUCTS: readonly Product[] = [
  product(
    'SUT-1L',
    'Süt 1 L',
    'Günlük pastörize tam yağlı süt',
    'cat_sut-kahvaltilik',
    PRODUCT_UNIT.LITER,
  ),
  product(
    'YUMURTA-10',
    'Yumurta 10’lu',
    'Gezen tavuk yumurtası',
    'cat_sut-kahvaltilik',
    PRODUCT_UNIT.PACK,
  ),
  product(
    'PEYNIR-500',
    'Beyaz Peynir 500 g',
    'Tam yağlı inek peyniri',
    'cat_sut-kahvaltilik',
    PRODUCT_UNIT.PIECE,
  ),
  product(
    'TEREYAG-250',
    'Tereyağı 250 g',
    'Günlük çiftlik tereyağı',
    'cat_sut-kahvaltilik',
    PRODUCT_UNIT.PIECE,
  ),
  product('DOMATES-1K', 'Domates 1 kg', 'Salkım domates', 'cat_meyve-sebze', PRODUCT_UNIT.KILOGRAM),
  product('MUZ-1K', 'Muz 1 kg', 'İthal muz', 'cat_meyve-sebze', PRODUCT_UNIT.KILOGRAM),
  product('ELMA-1K', 'Elma 1 kg', 'Amasya elması', 'cat_meyve-sebze', PRODUCT_UNIT.KILOGRAM),
  product(
    'SALATALIK-1K',
    'Salatalık 1 kg',
    'Çengelköy salatalık',
    'cat_meyve-sebze',
    PRODUCT_UNIT.KILOGRAM,
  ),
  product('SU-5L', 'Su 5 L', 'Doğal kaynak suyu', 'cat_icecek', PRODUCT_UNIT.LITER),
  product('KOLA-1L', 'Kola 1 L', 'Gazlı içecek', 'cat_icecek', PRODUCT_UNIT.LITER),
  product(
    'PORTAKAL-SUYU-1L',
    'Portakal Suyu 1 L',
    'Meyve suyu, %100 portakal',
    'cat_icecek',
    PRODUCT_UNIT.LITER,
  ),
  product('CIKOLATA-80', 'Çikolata 80 g', 'Sütlü çikolata', 'cat_atistirmalik', PRODUCT_UNIT.PIECE),
  product('CIPS-150', 'Cips 150 g', 'Klasik patates cipsi', 'cat_atistirmalik', PRODUCT_UNIT.PIECE),
  product(
    'BULASIK-DETERJAN',
    'Bulaşık Deterjanı 750 ml',
    'Limon kokulu',
    'cat_temizlik',
    PRODUCT_UNIT.PIECE,
  ),
  product('CAMASIR-SUYU', 'Çamaşır Suyu 1 L', 'Mevsimsel ürün', 'cat_temizlik', PRODUCT_UNIT.PIECE),
];

function product(
  sku: string,
  name: string,
  description: string,
  categoryId: string,
  unit: Product['unit'],
): Product {
  const slug = sku.toLowerCase();
  return {
    id: `prd_${slug}`,
    sku,
    name,
    description,
    categoryId,
    unit,
    imageUrl: `/img/urun/${slug}.png`,
  };
}
