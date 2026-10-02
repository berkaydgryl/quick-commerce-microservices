/**
 * Adres ekleme ve harita adres servisi sozlesmesi (T11.8).
 */

import { describe, expect, it } from 'vitest';

import {
  ADDRESS_TITLE_MAX_LENGTH,
  ADDRESS_UNIT_MAX_LENGTH,
  createAddressRequestSchema,
  GEO_SEARCH_RESULTS_MAX,
  geoSearchQuerySchema,
  geoSearchResultSchema,
  reverseGeocodeQuerySchema,
  savedAddressSchema,
} from '../../src/index.js';

const REQUEST = {
  title: 'Ev',
  kind: 'HOME' as const,
  line: 'Caferağa, Moda Caddesi 12, 34710 Kadıköy/İstanbul, Türkiye',
  location: { lat: 40.9885, lng: 29.027 },
  building: '12',
  floor: '3',
  apartment: '6',
  note: 'Kapı zili çalışmıyor',
};

function messages(value: unknown) {
  const result = createAddressRequestSchema.safeParse(value);
  return result.success ? {} : result.error.flatten().fieldErrors;
}

describe('createAddressRequestSchema (T11.8)', () => {
  it('eksiksiz istegi kabul eder; bina/kat/daire/tarif istege bagli', () => {
    expect(createAddressRequestSchema.safeParse(REQUEST).success).toBe(true);
    const { building: _b, floor: _f, apartment: _a, note: _n, ...minimal } = REQUEST;
    expect(createAddressRequestSchema.safeParse(minimal).success).toBe(true);
  });

  it('bos baslik ve adres Turkce mesajla reddedilir', () => {
    expect(messages({ ...REQUEST, title: ' ', line: '' })).toEqual({
      title: ['Başlık boş olamaz'],
      line: ['Adres boş olamaz'],
    });
  });

  it('uzun baslik ve bina/kat/daire alan adiyla reddedilir', () => {
    const long = (n: number) => 'a'.repeat(n + 1);
    expect(
      messages({
        ...REQUEST,
        title: long(ADDRESS_TITLE_MAX_LENGTH),
        building: long(ADDRESS_UNIT_MAX_LENGTH),
        apartment: long(ADDRESS_UNIT_MAX_LENGTH),
      }),
    ).toEqual({
      title: [`Başlık en fazla ${ADDRESS_TITLE_MAX_LENGTH} karakter olabilir`],
      building: [`Bina en fazla ${ADDRESS_UNIT_MAX_LENGTH} karakter olabilir`],
      apartment: [`Daire en fazla ${ADDRESS_UNIT_MAX_LENGTH} karakter olabilir`],
    });
  });

  it('bilinmeyen adres turu ve konumsuz istek reddedilir', () => {
    expect(createAddressRequestSchema.safeParse({ ...REQUEST, kind: 'YAZLIK' }).success).toBe(
      false,
    );
    const { location: _l, ...noLocation } = REQUEST;
    expect(createAddressRequestSchema.safeParse(noLocation).success).toBe(false);
  });

  it('kayitli adres yeni alanlari tasir; eski kayit (turu yok) da gecerli', () => {
    expect(savedAddressSchema.safeParse(REQUEST).success).toBe(true);
    expect(
      savedAddressSchema.safeParse({ title: 'Ev', line: 'Moda', location: REQUEST.location })
        .success,
    ).toBe(true);
  });
});

describe('harita adres servisi (T11.8)', () => {
  it('ters cozumleme sorgusu sayilari sorgu dizesinden okur', () => {
    expect(reverseGeocodeQuerySchema.parse({ lat: '40.98', lng: '29.02' })).toEqual({
      lat: 40.98,
      lng: 29.02,
    });
    expect(reverseGeocodeQuerySchema.safeParse({ lat: '91', lng: '29' }).success).toBe(false);
  });

  it('arama en az 3 karakter; sonuc listesi sinirli', () => {
    expect(geoSearchQuerySchema.safeParse({ q: 'mo' }).success).toBe(false);
    expect(geoSearchQuerySchema.safeParse({ q: 'moda' }).success).toBe(true);
    const place = { line: 'Moda', location: REQUEST.location };
    const items = Array.from({ length: GEO_SEARCH_RESULTS_MAX + 1 }, () => place);
    expect(geoSearchResultSchema.safeParse({ items }).success).toBe(false);
  });
});
