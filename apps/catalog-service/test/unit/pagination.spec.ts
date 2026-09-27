import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from '@getir/contracts';
import { describe, expect, it } from 'vitest';

import { normalizePageSize, sliceByCursor } from '../../src/domain/pagination.js';

const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }];

describe('normalizePageSize', () => {
  it('verilmeyen, sifir ve negatif degerde varsayilani uygular', () => {
    expect(normalizePageSize(undefined)).toBe(PAGE_SIZE_DEFAULT);
    expect(normalizePageSize(0)).toBe(PAGE_SIZE_DEFAULT);
    expect(normalizePageSize(-5)).toBe(PAGE_SIZE_DEFAULT);
  });

  it('ust siniri asan degeri REDDETMEZ, kirpar', () => {
    // Sozlesme boyle diyor: istek reddedilmez, sessizce kirpilir.
    expect(normalizePageSize(1_000)).toBe(PAGE_SIZE_MAX);
  });

  it('gecerli degeri oldugu gibi birakir', () => {
    expect(normalizePageSize(7)).toBe(7);
  });
});

describe('sliceByCursor', () => {
  it('ilk sayfayi ve sonraki imleci verir', () => {
    expect(sliceByCursor(items, 2, '')).toEqual({
      items: [{ id: 'a' }, { id: 'b' }],
      nextPageToken: 'b',
    });
  });

  it('imlecten SONRAKI kayitlarla devam eder', () => {
    expect(sliceByCursor(items, 2, 'b')).toEqual({
      items: [{ id: 'c' }, { id: 'd' }],
      nextPageToken: 'd',
    });
  });

  it('son sayfada imlec bos doner', () => {
    expect(sliceByCursor(items, 2, 'd')).toEqual({ items: [{ id: 'e' }], nextPageToken: '' });
  });

  it('listenin otesindeki imlecte bos sayfa doner', () => {
    expect(sliceByCursor(items, 2, 'z')).toEqual({ items: [], nextPageToken: '' });
  });

  it('sayfa tam bittiginde imlec bos doner (fazladan bos sayfa yok)', () => {
    // Bes kayit, bes kayitlik sayfa: devam yok demektir.
    expect(sliceByCursor(items, 5, '').nextPageToken).toBe('');
  });
});
