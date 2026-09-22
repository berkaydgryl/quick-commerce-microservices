import { describe, expect, it } from 'vitest';

import {
  matchesQuery,
  PRODUCT_UNIT,
  sortCategories,
  sortProducts,
} from '../../src/domain/catalog.js';
import type { Category, Product } from '../../src/domain/catalog.js';

function category(id: string, name: string, sortOrder: number): Category {
  return { id, name, slug: id, sortOrder, imageUrl: '' };
}

const product: Product = {
  id: 'prd_1',
  sku: 'SUT-1L',
  name: 'Süt 1 L',
  description: 'Günlük pastörize tam yağlı süt',
  priceMinor: 3490,
  categoryId: 'cat_1',
  unit: PRODUCT_UNIT.LITER,
  imageUrl: '',
  isActive: true,
};

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

describe('sortProducts', () => {
  it('kimlige gore kararli sira uretir (sayfalama imleci buna dayanir)', () => {
    const sorted = sortProducts([
      { ...product, id: 'prd_10' },
      { ...product, id: 'prd_02' },
    ]);

    expect(sorted.map((item) => item.id)).toEqual(['prd_02', 'prd_10']);
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
