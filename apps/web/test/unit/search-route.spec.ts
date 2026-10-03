/**
 * Genel aramanin adresi (T11.10): ust bardaki kutu baska sayfadan aramayi ana
 * sayfaya, sonuclara tasir.
 */

import { describe, expect, it } from 'vitest';

import {
  SEARCH_PARAM,
  SEARCH_PATH,
  searchHref,
} from '../../src/features/search/services/search-route';

describe('searchHref', () => {
  it('ana sayfanin ?ara= parametresine yazar; Turkce harf ve bosluk kodlanir', () => {
    expect(searchHref('süt')).toBe('/?ara=s%C3%BCt');
    expect(searchHref('tam yağlı süt')).toBe('/?ara=tam+ya%C4%9Fl%C4%B1+s%C3%BCt');
  });

  it('adres ve parametre ana sayfanin okudugu yerle ayni', () => {
    const url = new URL(searchHref('ekmek & peynir'), 'http://localhost');
    expect(url.pathname).toBe(SEARCH_PATH);
    expect(url.searchParams.get(SEARCH_PARAM)).toBe('ekmek & peynir');
  });
});
