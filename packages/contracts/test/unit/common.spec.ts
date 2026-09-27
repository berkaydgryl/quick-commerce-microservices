import { CURRENCY } from '@getir/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  LATITUDE_MAX,
  LATITUDE_MIN,
  LONGITUDE_MAX,
  LONGITUDE_MIN,
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

  it('para birimi core daki tek sabittir (D7: TRY baska yerde yazilmaz)', () => {
    expect(moneySchema.shape.currency.value).toBe(CURRENCY);
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

  it('sinirlar dahildir: kutup ve tarih degistirme cizgisi gecerli konumdur', () => {
    expect(geoPointSchema.safeParse({ lat: LATITUDE_MAX, lng: LONGITUDE_MIN }).success).toBe(true);
    expect(geoPointSchema.safeParse({ lat: LATITUDE_MIN, lng: LONGITUDE_MAX }).success).toBe(true);
  });

  it('sonsuz deger reddedilir (JSON tasiyamaz ama gRPC double tasir)', () => {
    expect(geoPointSchema.safeParse({ lat: Number.POSITIVE_INFINITY, lng: 0 }).success).toBe(false);
  });

  // D6: bu mesajlar gateway'den REST zarfinin details alanina aynen gecer.
  it.each([
    [{ lat: 91, lng: 0 }, 'lat', 'enlem -90 ile 90 arasinda olmali'],
    [{ lat: 0, lng: -181 }, 'lng', 'boylam -180 ile 180 arasinda olmali'],
    [{ lat: '41', lng: 0 }, 'lat', 'sayi olmali'],
    [{ lng: 0 }, 'lat', 'zorunlu'],
  ])('hata mesaji Turkce: %o', (input, field, message) => {
    const issues = geoPointSchema.safeParse(input).error?.issues ?? [];

    expect(issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([
      [field, message],
    ]);
  });

  it('konumun kendisi eksikse "zorunlu" (ic ice alan olarak)', () => {
    const issues = z.object({ location: geoPointSchema }).safeParse({}).error?.issues ?? [];

    expect(issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([
      ['location', 'zorunlu'],
    ]);
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
