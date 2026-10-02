/**
 * Demo verisi: platform kategorileri ve ORTAK urunler (fiyatsiz - ADR-15).
 * Bkz. ../fixtures.ts (tek giris noktasi ve gerekce).
 */

import type { Category, Product } from '../../domain/catalog.js';
import { PRODUCT_UNIT } from '../../domain/catalog.js';

/**
 * Platform kategorileri (T11.6 PR 3'ten beri 13): once gida, sonra ev ve kisisel
 * bakim; ilk bestekinin birbirine gore sirasi korundu. Sekizine henuz urun
 * baglanmadi: karsilama ekraninin vitrini ve ana sayfa seridi icindir; market
 * sayfasi yalnizca teklifi olan kategorileri gosterir (ListMarketCategories).
 * Gorseller web'in public/img/cat klasorundedir (CC0, apps/web/README.md).
 */
export const CATEGORIES: readonly Category[] = [
  {
    id: 'cat_sut-kahvaltilik',
    name: 'Süt & Kahvaltılık',
    slug: 'sut-kahvaltilik',
    sortOrder: 1,
    imageUrl: '/img/cat/sut.jpg',
  },
  {
    id: 'cat_meyve-sebze',
    name: 'Meyve & Sebze',
    slug: 'meyve-sebze',
    sortOrder: 2,
    imageUrl: '/img/cat/manav.jpg',
  },
  {
    id: 'cat_firindan',
    name: 'Fırından',
    slug: 'firindan',
    sortOrder: 3,
    imageUrl: '/img/cat/firindan.jpg',
  },
  {
    id: 'cat_temel-gida',
    name: 'Temel Gıda',
    slug: 'temel-gida',
    sortOrder: 4,
    imageUrl: '/img/cat/temel-gida.jpg',
  },
  {
    id: 'cat_et-tavuk',
    name: 'Et & Tavuk',
    slug: 'et-tavuk',
    sortOrder: 5,
    imageUrl: '/img/cat/et-tavuk.jpg',
  },
  {
    id: 'cat_icecek',
    name: 'İçecek',
    slug: 'icecek',
    sortOrder: 6,
    imageUrl: '/img/cat/icecek.jpg',
  },
  {
    id: 'cat_atistirmalik',
    name: 'Atıştırmalık',
    slug: 'atistirmalik',
    sortOrder: 7,
    imageUrl: '/img/cat/atistirmalik.jpg',
  },
  {
    id: 'cat_dondurma',
    name: 'Dondurma',
    slug: 'dondurma',
    sortOrder: 8,
    imageUrl: '/img/cat/dondurma.jpg',
  },
  {
    id: 'cat_temizlik',
    name: 'Temizlik',
    slug: 'temizlik',
    sortOrder: 9,
    imageUrl: '/img/cat/temizlik.jpg',
  },
  {
    id: 'cat_kisisel-bakim',
    name: 'Kişisel Bakım',
    slug: 'kisisel-bakim',
    sortOrder: 10,
    imageUrl: '/img/cat/kisisel-bakim.jpg',
  },
  {
    id: 'cat_ev-yasam',
    name: 'Ev & Yaşam',
    slug: 'ev-yasam',
    sortOrder: 11,
    imageUrl: '/img/cat/ev-yasam.jpg',
  },
  {
    id: 'cat_bebek',
    name: 'Bebek',
    slug: 'bebek',
    sortOrder: 12,
    imageUrl: '/img/cat/bebek.jpg',
  },
  {
    id: 'cat_evcil-hayvan',
    name: 'Evcil Hayvan',
    slug: 'evcil-hayvan',
    sortOrder: 13,
    imageUrl: '/img/cat/evcil-hayvan.jpg',
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
