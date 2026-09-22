/**
 * Demo verisinin butunlugu. Seed ve MOCK modu bu veriyi kullanir; burada bir
 * hata ya seed'i (benzersiz indeks ihlali) ya da istemciyi (bos kategori) bozar.
 */

import { describe, expect, it } from 'vitest';

import { CATALOG_SNAPSHOT } from '../../src/infrastructure/fixtures.js';

const { categories, products, darkStores, assortment } = CATALOG_SNAPSHOT;

function duplicates(values: readonly string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) !== index);
}

describe('katalog demo verisi', () => {
  it('T4.1 olcutu: 5 kategori, 15 urun, 2 dark store', () => {
    expect(categories).toHaveLength(5);
    expect(products).toHaveLength(15);
    expect(darkStores).toHaveLength(2);
  });

  it('benzersiz alanlar gercekten benzersiz (seed indeks ihlaliyle dusmesin)', () => {
    expect(duplicates(categories.map((category) => category.id))).toEqual([]);
    expect(duplicates(categories.map((category) => category.slug))).toEqual([]);
    expect(duplicates(products.map((product) => product.id))).toEqual([]);
    expect(duplicates(products.map((product) => product.sku))).toEqual([]);
    expect(duplicates(darkStores.map((store) => store.id))).toEqual([]);
  });

  it('her urunun kategorisi var ve her kategoride urun var', () => {
    const categoryIds = new Set(categories.map((category) => category.id));

    expect(products.filter((product) => !categoryIds.has(product.categoryId))).toEqual([]);
    for (const category of categories) {
      expect(products.some((product) => product.categoryId === category.id)).toBe(true);
    }
  });

  it('cesit tablosu yalnizca var olan depo ve urunlere isaret eder', () => {
    const storeIds = new Set(darkStores.map((store) => store.id));
    const productIds = new Set(products.map((product) => product.id));

    expect(Object.keys(assortment).sort()).toEqual([...storeIds].sort());
    for (const productIdsInStore of Object.values(assortment)) {
      expect(productIdsInStore.filter((id) => !productIds.has(id))).toEqual([]);
    }
  });

  it('fiyatlar kurus cinsinden pozitif tam sayi', () => {
    for (const product of products) {
      expect(Number.isInteger(product.priceMinor)).toBe(true);
      expect(product.priceMinor).toBeGreaterThan(0);
    }
  });

  it('gorseller GORELI yoldur: alan adi veriye yazilmaz', () => {
    // Mutlak URL'yi gateway (BFF) ASSET_BASE_URL ile kurar. Veriye alan adi
    // yazilirsa ortam degistiginde tum kayitlarin guncellenmesi gerekir.
    const imageUrls = [
      ...categories.map((category) => category.imageUrl),
      ...products.map((product) => product.imageUrl),
    ];

    for (const imageUrl of imageUrls) {
      expect(imageUrl.startsWith('/')).toBe(true);
      expect(imageUrl).not.toContain('://');
    }
  });

  it('iki depo da acik (adres senaryosu ikisine de dusmeli)', () => {
    expect(darkStores.every((store) => store.isOpen)).toBe(true);
  });
});
