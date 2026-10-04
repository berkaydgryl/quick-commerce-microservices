/** Logonun yerine bas harf rozeti (T11.11 karari; T11.12 karti). */

import { describe, expect, it } from 'vitest';

import { marketInitials } from '../../src/features/markets/services/market-initials';

describe('marketInitials', () => {
  it.each([
    ['Migros Jet', 'MJ'],
    ['Carrefour Express', 'CE'],
    ['Pati Pet Shop', 'PP'],
    ['ŞOK', 'Ş'],
    ['A101', 'A'],
    ['BİM', 'B'],
    // Turkce buyuk harf: "i" -> "İ".
    ['ilkem kuruyemiş', 'İK'],
    ['  Kardeşler   Manavı ', 'KM'],
  ])('%j -> %s', (brand, initials) => {
    expect(marketInitials(brand)).toBe(initials);
  });
});
