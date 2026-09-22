/**
 * Katalog demo verisi - TEK KAYNAK (T4.1).
 *
 * Iki moda birden hizmet eder:
 *   - MOCK=true : InMemoryCatalogRepository bu veriyi dogrudan dondurur,
 *   - seed      : `pnpm seed` ayni veriyi Mongo'ya yazar (src/seed.ts).
 * Iki ayri kopya olsaydi MOCK modu ile gercek mod zamanla farkli katalog
 * gosterirdi ve frontend "mock'ta calisiyordu" hatasiyla karsilasirdi.
 *
 * NEDEN infra/seed ALTINDA DEGIL (roadmap boyle ciziyordu): (1) veri bu
 * servisin koleksiyonlarinin verisidir ve ADR-05 geregi onlara yalnizca bu
 * servis yazar; (2) .dockerignore infra/'yi imaja almaz - MOCK modundaki
 * konteyner veriyi bulamazdi.
 *
 * Miktar: 5 kategori, 15 urun, 2 dark store (T4.1 olcutu).
 * Fiyatlar KURUS cinsinden tam sayidir (2999 = 29,99 TL).
 *
 * GORSELLER GORELI YOLDUR ("/img/cat/sut.png"), bilerek: mutlak adres ortama
 * baglidir (yerel, demo, canli). Veri yolu saklar; istemciye giden mutlak URL'yi
 * gateway (BFF) kendi ASSET_BASE_URL ayariyla kurar. Bu yuzden buraya alan adi
 * YAZILMAZ.
 */

import type { Category, DarkStore, Product } from '../domain/catalog.js';
import { PRODUCT_UNIT } from '../domain/catalog.js';
import type { CatalogSnapshot } from '../domain/catalog-snapshot.js';

export const CATEGORIES: readonly Category[] = [
  {
    id: 'cat_1',
    name: 'Süt & Kahvaltılık',
    slug: 'sut-kahvaltilik',
    sortOrder: 1,
    imageUrl: '/img/cat/sut.png',
  },
  {
    id: 'cat_2',
    name: 'Meyve & Sebze',
    slug: 'meyve-sebze',
    sortOrder: 2,
    imageUrl: '/img/cat/manav.png',
  },
  { id: 'cat_3', name: 'İçecek', slug: 'icecek', sortOrder: 3, imageUrl: '/img/cat/icecek.png' },
  {
    id: 'cat_4',
    name: 'Atıştırmalık',
    slug: 'atistirmalik',
    sortOrder: 4,
    imageUrl: '/img/cat/atistirmalik.png',
  },
  {
    id: 'cat_5',
    name: 'Temizlik',
    slug: 'temizlik',
    sortOrder: 5,
    imageUrl: '/img/cat/temizlik.png',
  },
];

export const PRODUCTS: readonly Product[] = [
  product(
    'prd_01',
    'SUT-1L',
    'Süt 1 L',
    'Günlük pastörize tam yağlı süt',
    3490,
    'cat_1',
    PRODUCT_UNIT.LITER,
  ),
  product(
    'prd_02',
    'YUMURTA-10',
    'Yumurta 10’lu',
    'Gezen tavuk yumurtası',
    8990,
    'cat_1',
    PRODUCT_UNIT.PACK,
  ),
  product(
    'prd_03',
    'PEYNIR-500',
    'Beyaz Peynir 500 g',
    'Tam yağlı inek peyniri',
    14990,
    'cat_1',
    PRODUCT_UNIT.PIECE,
  ),
  product(
    'prd_04',
    'TEREYAG-250',
    'Tereyağı 250 g',
    'Günlük çiftlik tereyağı',
    12750,
    'cat_1',
    PRODUCT_UNIT.PIECE,
  ),
  product(
    'prd_05',
    'DOMATES-1K',
    'Domates 1 kg',
    'Salkım domates',
    5990,
    'cat_2',
    PRODUCT_UNIT.KILOGRAM,
  ),
  product('prd_06', 'MUZ-1K', 'Muz 1 kg', 'İthal muz', 7490, 'cat_2', PRODUCT_UNIT.KILOGRAM),
  product('prd_07', 'ELMA-1K', 'Elma 1 kg', 'Amasya elması', 4290, 'cat_2', PRODUCT_UNIT.KILOGRAM),
  product(
    'prd_08',
    'SALATALIK-1K',
    'Salatalık 1 kg',
    'Çengelköy salatalık',
    3990,
    'cat_2',
    PRODUCT_UNIT.KILOGRAM,
  ),
  product('prd_09', 'SU-5L', 'Su 5 L', 'Doğal kaynak suyu', 2990, 'cat_3', PRODUCT_UNIT.LITER),
  product('prd_10', 'KOLA-1L', 'Kola 1 L', 'Gazlı içecek', 4590, 'cat_3', PRODUCT_UNIT.LITER),
  product(
    'prd_11',
    'PORTAKAL-SUYU-1L',
    'Portakal Suyu 1 L',
    'Meyve suyu, %100 portakal',
    6490,
    'cat_3',
    PRODUCT_UNIT.LITER,
  ),
  product(
    'prd_12',
    'CIKOLATA-80',
    'Çikolata 80 g',
    'Sütlü çikolata',
    3290,
    'cat_4',
    PRODUCT_UNIT.PIECE,
  ),
  product(
    'prd_13',
    'CIPS-150',
    'Cips 150 g',
    'Klasik patates cipsi',
    4990,
    'cat_4',
    PRODUCT_UNIT.PIECE,
  ),
  product(
    'prd_14',
    'BULASIK-DETERJAN',
    'Bulaşık Deterjanı 750 ml',
    'Limon kokulu',
    6790,
    'cat_5',
    PRODUCT_UNIT.PIECE,
  ),
  // Pasif urun BILEREK var: "silinmis" ile "satista degil" ayrimini test eder.
  {
    ...product(
      'prd_15',
      'CAMASIR-SUYU',
      'Çamaşır Suyu 1 L',
      'Mevsimsel ürün',
      5490,
      'cat_5',
      PRODUCT_UNIT.PIECE,
    ),
    isActive: false,
  },
];

export const DARK_STORES: readonly DarkStore[] = [
  {
    id: 'ds_kadikoy',
    name: 'Kadıköy Deposu',
    lat: 40.9903,
    lng: 29.0275,
    deliveryRadiusMeters: 2500,
    isOpen: true,
  },
  {
    // ACIK, bilerek (T4.1): roadmap'in adres tablosunda "Is" adresi bu depoya
    // duser ve demoda farkli bir cesit gosterir. Kapali olsaydi o adres de
    // NO_STORE alirdi ve iki depolu demonun anlami kalmazdi. Kapali depo
    // davranisi (STORE_CLOSED) T4.2'de kendi test verisiyle sinanir.
    id: 'ds_besiktas',
    name: 'Beşiktaş Deposu',
    lat: 41.0422,
    lng: 29.0093,
    deliveryRadiusMeters: 2000,
    isOpen: true,
  },
];

/**
 * Hangi depoda hangi urun SATILIYOR (cesit bilgisi).
 *
 * Bu bir STOK bilgisi DEGILDIR - adet inventory-svc'dedir (B27). Burada
 * yalnizca "bu depo bu urunu satiyor mu" sorusu cevaplanir. Besiktas bilincli
 * olarak dar bir cesit tasiyor ki depo filtresinin gercekten uygulandigi
 * testte gorulebilsin.
 */
export const STORE_ASSORTMENT: Readonly<Record<string, readonly string[]>> = {
  ds_kadikoy: PRODUCTS.map((item) => item.id),
  ds_besiktas: ['prd_01', 'prd_05', 'prd_09', 'prd_12'],
};

/** Katalogun tamami: MOCK modu ve seed ayni degeri kullanir. */
export const CATALOG_SNAPSHOT: CatalogSnapshot = {
  categories: CATEGORIES,
  products: PRODUCTS,
  darkStores: DARK_STORES,
  assortment: STORE_ASSORTMENT,
};

function product(
  id: string,
  sku: string,
  name: string,
  description: string,
  priceMinor: number,
  categoryId: string,
  unit: Product['unit'],
): Product {
  return {
    id,
    sku,
    name,
    description,
    priceMinor,
    categoryId,
    unit,
    imageUrl: `/img/urun/${sku.toLowerCase()}.png`,
    isActive: true,
  };
}
