import { describe, expect, it } from 'vitest';

import {
  firstCategories,
  matchesQuery,
  offerIdFor,
  PRODUCT_UNIT,
  searchKey,
  searchWords,
  sortCategories,
  sortOffers,
} from '../../src/domain/catalog.js';
import type { Category, Offer, Product } from '../../src/domain/catalog.js';

function category(id: string, name: string, sortOrder: number): Category {
  return { id, name, slug: id, sortOrder, imageUrl: '' };
}

const product: Product = {
  id: 'prd_1',
  sku: 'SUT-1L',
  name: 'Süt 1 L',
  description: 'Günlük pastörize tam yağlı süt',
  categoryId: 'cat_1',
  unit: PRODUCT_UNIT.LITER,
  imageUrl: '',
};

function offer(id: string): Offer {
  return { id, marketId: 'mkt_a', product, priceMinor: 3490, isActive: true };
}

describe('sortCategories', () => {
  it('sort_order kucukten buyuge dizer', () => {
    const sorted = sortCategories([category('c', 'C', 3), category('a', 'A', 1)]);

    expect(sorted.map((item) => item.id)).toEqual(['a', 'c']);
  });

  it('esit sirada ada gore dizer (liste her istekte ayni olsun)', () => {
    const sorted = sortCategories([category('z', 'Zeytin', 1), category('a', 'Ayran', 1)]);

    expect(sorted.map((item) => item.name)).toEqual(['Ayran', 'Zeytin']);
  });

  it('girdiyi degistirmez', () => {
    const input = [category('c', 'C', 3), category('a', 'A', 1)];
    sortCategories(input);

    expect(input[0]?.id).toBe('c');
  });
});

describe('firstCategories (D6: kategori okumasinin kesme kurali)', () => {
  const categories = [
    category('cat_c', 'C', 2),
    category('cat_b', 'B', 1),
    category('cat_a', 'A', 2),
  ];

  it('sortOrder, esitlikte kimlik (ikili) sirasinin ilk limit kadarini birakir', () => {
    expect(firstCategories(categories, 2).map((item) => item.id)).toEqual(['cat_b', 'cat_a']);
  });

  it('limit liste boyundan buyukse hepsini doner, girdiyi degistirmez', () => {
    expect(firstCategories(categories, 10)).toHaveLength(3);
    expect(categories[0]?.id).toBe('cat_c');
  });
});

describe('sortOffers', () => {
  it('kimlige gore kararli sira uretir (sayfalama imleci buna dayanir)', () => {
    const sorted = sortOffers([offer('ofr_b-10'), offer('ofr_b-02'), offer('ofr_a-99')]);

    expect(sorted.map((item) => item.id)).toEqual(['ofr_a-99', 'ofr_b-02', 'ofr_b-10']);
  });

  it('IKILI siralama: tire harften once gelir (Mongo ile ayni)', () => {
    // localeCompare tireyi yok sayabilirdi; imlec "_id > token" ikili calisir.
    const sorted = sortOffers([offer('ofr_ab'), offer('ofr_a-b')]);

    expect(sorted.map((item) => item.id)).toEqual(['ofr_a-b', 'ofr_ab']);
  });
});

describe('offerIdFor', () => {
  it('market ve urunden turetilir, seed tekrarinda degismez', () => {
    expect(offerIdFor('mkt_migros-jet-moda', 'prd_sut-1l')).toBe('ofr_migros-jet-moda-sut-1l');
  });
});

describe('searchKey (T9.4)', () => {
  it.each([
    ['Süt', 'sut'],
    ['ÇİKOLATA', 'cikolata'],
    ['IŞIK', 'isik'],
    ['İthal muz', 'ithal muz'],
    ['Çengelköy', 'cengelkoy'],
    ['  Tereyağı ', 'tereyagi'],
    ['hâlâ', 'hala'],
    ['%100 portakal', '%100 portakal'],
  ])('%s -> %s: Turkce kurallarla kucuk harf, Turkce karakterler katlanir', (text, key) => {
    expect(searchKey(text)).toBe(key);
  });
});

describe('searchWords (T9.4)', () => {
  it('bosluklarla ayrilir, normalize edilir, tekrar eden tek sayilir', () => {
    expect(searchWords('  Beyaz   PEYNİR ')).toEqual(['beyaz', 'peynir']);
    expect(searchWords('süt SÜT sut')).toEqual(['sut']);
  });
});

describe('matchesQuery', () => {
  it('ad ve aciklamada arar', () => {
    expect(matchesQuery(product, 'süt')).toBe(true);
    expect(matchesQuery(product, 'pastörize')).toBe(true);
  });

  it('buyuk/kucuk harf duyarsizdir', () => {
    expect(matchesQuery(product, 'SÜT')).toBe(true);
  });

  it('Turkce karakter duyarsizdir: "sut" da "Süt"u bulur (T9.4)', () => {
    expect(matchesQuery(product, 'sut')).toBe(true);
    expect(matchesQuery(product, 'pastorize tam yagli')).toBe(true);
  });

  it('kelime icinde de eslesir: yazarken arama (T9.4)', () => {
    expect(matchesQuery(product, 'pastö')).toBe(true);
  });

  it('cok kelimede her kelime gecmeli, sira onemsiz; kelimeler ad ve aciklamaya dagilabilir (T9.4)', () => {
    expect(matchesQuery(product, '1 süt')).toBe(true);
    expect(matchesQuery(product, 'süt günlük')).toBe(true);
    expect(matchesQuery(product, 'süt kola')).toBe(false);
  });

  it('eslesmeyen sorguda false doner', () => {
    expect(matchesQuery(product, 'çikolata')).toBe(false);
  });
});
