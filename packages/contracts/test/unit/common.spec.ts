import { describe, expect, it } from 'vitest';

import {
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  PAGE_SIZE_MIN,
  geoPointSchema,
  moneySchema,
  pageQuerySchema,
  pageSchema,
} from '../../src/index.js';

describe('moneySchema', () => {
  it('kurus cinsinden tam sayi kabul eder', () => {
    expect(moneySchema.parse({ amountMinor: 4599, currency: 'TRY' })).toEqual({
      amountMinor: 4599,
      currency: 'TRY',
    });
  });

  it('kusuratli tutari reddeder', () => {
    // 45.99 TL gibi bir deger kurusa cevrilmeden gonderilemez.
    expect(moneySchema.safeParse({ amountMinor: 45.99, currency: 'TRY' }).success).toBe(false);
  });

  it('negatif tutari reddeder', () => {
    expect(moneySchema.safeParse({ amountMinor: -1, currency: 'TRY' }).success).toBe(false);
  });

  it('TRY disinda para birimi kabul etmez', () => {
    expect(moneySchema.safeParse({ amountMinor: 100, currency: 'USD' }).success).toBe(false);
  });
});

describe('geoPointSchema', () => {
  it('gecerli koordinati kabul eder', () => {
    expect(geoPointSchema.parse({ lat: 41.0082, lng: 28.9784 })).toEqual({
      lat: 41.0082,
      lng: 28.9784,
    });
  });

  it('aralik disini reddeder', () => {
    expect(geoPointSchema.safeParse({ lat: 91, lng: 0 }).success).toBe(false);
    expect(geoPointSchema.safeParse({ lat: 0, lng: 181 }).success).toBe(false);
  });

  it('alan adlari lat/lng olmak zorundadir', () => {
    expect(geoPointSchema.safeParse({ latitude: 41, longitude: 28 }).success).toBe(false);
  });
});

describe('pageSchema', () => {
  it('bos nextPageToken listenin bittigini soyler', () => {
    expect(pageSchema.parse({ nextPageToken: '', totalSize: 0 })).toEqual({
      nextPageToken: '',
      totalSize: 0,
    });
  });
});

describe('pageQuerySchema', () => {
  it('pageSize verilmezse varsayilani uygular', () => {
    expect(pageQuerySchema.parse({}).pageSize).toBe(PAGE_SIZE_DEFAULT);
  });

  it('ust sinirin ustunu REDDETMEZ, kirpar', () => {
    expect(pageQuerySchema.parse({ pageSize: 1000 }).pageSize).toBe(PAGE_SIZE_MAX);
  });

  it('alt sinirin altini kirpar', () => {
    expect(pageQuerySchema.parse({ pageSize: 0 }).pageSize).toBe(PAGE_SIZE_MIN);
  });

  it('sorgu dizesinden gelen metni sayiya cevirir', () => {
    expect(pageQuerySchema.parse({ pageSize: '30' }).pageSize).toBe(30);
  });
});
