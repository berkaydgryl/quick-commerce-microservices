import { describe, expect, it } from 'vitest';

import {
  matchesQuery,
  offerIdFor,
  PRODUCT_UNIT,
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

describe('matchesQuery', () => {
  it('ad ve aciklamada arar', () => {
    expect(matchesQuery(product, 'süt')).toBe(true);
    expect(matchesQuery(product, 'pastörize')).toBe(true);
  });

  it('buyuk/kucuk harf duyarsizdir', () => {
    expect(matchesQuery(product, 'SÜT')).toBe(true);
  });

  it('eslesmeyen sorguda false doner', () => {
    expect(matchesQuery(product, 'çikolata')).toBe(false);
  });
});
