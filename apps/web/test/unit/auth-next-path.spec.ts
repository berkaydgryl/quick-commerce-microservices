import { describe, expect, it } from 'vitest';

import {
  loginPathFor,
  safeNextPath,
  withNextPath,
} from '../../src/features/auth/services/next-path';

describe('donus adresi (T8.5)', () => {
  it.each([
    ['/hesabim', '/hesabim'],
    [
      '/markets/mkt_a101-caferaga?kategori=cat_sut#urunler',
      '/markets/mkt_a101-caferaga?kategori=cat_sut#urunler',
    ],
    ['/%2F%2Fkotu.site', '/%2F%2Fkotu.site'],
  ])('uygulama ici yol korunur: %s', (raw, expected) => {
    expect(safeNextPath(raw)).toBe(expected);
  });

  it.each([
    [null],
    [''],
    ['hesabim'],
    ['//kotu.site/yol'],
    ['/\\kotu.site'],
    ['/\t/kotu.site'],
    ['https://kotu.site'],
    ['javascript:alert(1)'],
    ['/giris'],
    ['/kayit?next=/hesabim'],
  ])('baska siteye ya da donguye giden adres ana sayfa olur: %s', (raw) => {
    expect(safeNextPath(raw)).toBe('/');
  });

  it('donus adresi sorgu parametresinde kodlanir; ana sayfa icin parametre yok', () => {
    expect(withNextPath('/giris', '/')).toBe('/giris');
    expect(withNextPath('/giris', '/markets?x=1')).toBe('/giris?next=%2Fmarkets%3Fx%3D1');
  });

  it('korumali sayfanin giris adresi o sayfaya doner', () => {
    expect(loginPathFor({ pathname: '/hesabim', search: '' })).toBe('/giris?next=%2Fhesabim');
    expect(loginPathFor({ pathname: '/', search: '' })).toBe('/giris');
  });
});
