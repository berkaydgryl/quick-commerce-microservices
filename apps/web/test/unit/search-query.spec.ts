/** Market ici arama kurali (T9.5): hangi metin arama, hangisi degil. */

import { SEARCH_QUERY_MAX_LENGTH } from '@getir/contracts';
import { describe, expect, it } from 'vitest';

import { searchQueryFrom } from '../../src/features/catalog/services/search-query';

describe('searchQueryFrom', () => {
  it('bas ve son bosluk kirpilir', () => {
    expect(searchQueryFrom('  beyaz peynir ')).toBe('beyaz peynir');
  });

  it('iki karakterden kisa metin arama degildir (sunucu 400 donerdi)', () => {
    expect(searchQueryFrom('')).toBeUndefined();
    expect(searchQueryFrom('s')).toBeUndefined();
    expect(searchQueryFrom('  s  ')).toBeUndefined();
    expect(searchQueryFrom('su')).toBe('su');
  });

  it(`adrese elle yazilmis uzun metin ${SEARCH_QUERY_MAX_LENGTH} karaktere kirpilir`, () => {
    const long = 'a'.repeat(SEARCH_QUERY_MAX_LENGTH + 10);

    expect(searchQueryFrom(long)).toBe('a'.repeat(SEARCH_QUERY_MAX_LENGTH));
  });
});
