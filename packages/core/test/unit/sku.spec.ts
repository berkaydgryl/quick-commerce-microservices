import { describe, expect, it } from 'vitest';

import { isSku, SKU_PATTERN } from '../../src/constants.js';

describe('SKU bicim kurali', () => {
  it('gecerli sku degerlerini kabul eder', () => {
    for (const sku of ['SU-5LT', 'CIPS01', 'MUZ-1KG', 'A1B']) {
      expect(isSku(sku), sku).toBe(true);
    }
  });

  it('Redis anahtar duzenini bozacak karakterleri reddeder', () => {
    // Bosluk, iki nokta ve susleme parantezi anahtar ayiricisi ve hash-tag
    // karakteridir; sku icinde gecerse anahtar yanlis slot'a duser.
    for (const sku of ['SU 5LT', 'SU:5LT', '{SU}', 'su-5lt', 'AB', '']) {
      expect(isSku(sku), sku).toBe(false);
    }
  });

  it('uzunluk sinirlarini uygular (3-32 karakter)', () => {
    expect(isSku('A'.repeat(32))).toBe(true);
    expect(isSku('A'.repeat(33))).toBe(false);
  });

  it('desen tek kaynaktir ve disari acilir', () => {
    expect(SKU_PATTERN.source).toContain('A-Z0-9');
  });
});
