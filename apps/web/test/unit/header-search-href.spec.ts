/**
 * Ust bar aramasinin adresi (T11.10 duzeltmesi, QA B2): oturumsuz ziyaretcinin
 * aramasi karsilama ekraninda kaybolmaz, giris ekranina gider ve girince
 * aramaya doner.
 */

import { describe, expect, it } from 'vitest';

import { headerSearchHref } from '../../src/app/header-search-href';
import { NEXT_PARAM } from '../../src/features/auth/routes';
import { safeNextPath } from '../../src/features/auth/services/next-path';

describe('headerSearchHref', () => {
  it('oturumdaki kullanici dogrudan sonuclara gider', () => {
    expect(headerSearchHref('authenticated', 'süt')).toBe('/?ara=s%C3%BCt');
  });

  it('oturumsuz ziyaretci giris ekranina gider; donus adresi arama sonuclari', () => {
    const href = headerSearchHref('anonymous', 'tam yağlı süt');
    const url = new URL(href, 'http://localhost');

    expect(url.pathname).toBe('/giris');
    expect(url.searchParams.get(NEXT_PARAM)).toBe('/?ara=tam+ya%C4%9Fl%C4%B1+s%C3%BCt');
  });

  it('giris sonrasi donus adresi guvenli yol kuralindan oldugu gibi gecer (arama kaybolmaz)', () => {
    const next = new URL(headerSearchHref('anonymous', 'süt'), 'http://localhost').searchParams.get(
      NEXT_PARAM,
    );

    expect(safeNextPath(next)).toBe('/?ara=s%C3%BCt');
  });
});
