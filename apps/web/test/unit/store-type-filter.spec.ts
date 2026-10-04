/**
 * Market listesinin dukkan turu suzgeci (T11.12): adresteki ?tur= degeri,
 * sayim, menunun gruplari (icerikten) ve suzme. Gruplar ve adlar icerik
 * yedegiyle sinanir: welcome.json ile ayni oldugunu contracts testi denetler.
 */

import { CONTENT_FALLBACK } from '@getir/contracts';
import { describe, expect, it } from 'vitest';

import {
  countByStoreType,
  filterByStoreType,
  storeTypeFromParam,
  storeTypeGroups,
  storeTypeToParam,
} from '../../src/features/markets/services/store-type-filter';

import { NEARBY } from './market-list-test-support';

const CONTENT = CONTENT_FALLBACK.marketList;

describe('adresteki tur (?tur=)', () => {
  it.each([
    ['kasap', 'KASAP'],
    ['sarkuteri', 'SARKUTERI'],
    // Turkce buyuk harf "KURUYEMİS" uretirdi; adres ASCII'dir.
    ['kuruyemis', 'KURUYEMIS'],
    ['petshop', 'PETSHOP'],
  ] as const)('%s -> %s', (param, type) => {
    expect(storeTypeFromParam(param)).toBe(type);
    expect(storeTypeToParam(type)).toBe(param);
  });

  it.each([null, '', 'bakkal', 'kasap '])(
    'bilinmeyen ya da bos deger suzgec yok sayilir: %j',
    (param) => {
      expect(storeTypeFromParam(param)).toBeUndefined();
    },
  );
});

describe('countByStoreType', () => {
  it('turune gore sayar; turu bilinmeyen market sayilmaz (yalnizca "Tümü" altinda)', () => {
    expect(Object.fromEntries(countByStoreType(NEARBY))).toEqual({ MARKET: 2, KASAP: 1 });
  });
});

describe('storeTypeGroups', () => {
  it('icerikteki sirayla; adreste marketi olmayan tur ve grup gosterilmez', () => {
    const groups = storeTypeGroups(CONTENT, countByStoreType(NEARBY));

    expect(groups).toEqual([
      {
        label: 'Gıda & Market',
        imageUrl: '/img/market/market.jpg',
        count: 3,
        types: [
          { type: 'MARKET', label: 'Market', count: 2 },
          { type: 'KASAP', label: 'Kasap', count: 1 },
        ],
      },
    ]);
  });

  it('bos adres: menu bos (bos satir yok)', () => {
    expect(storeTypeGroups(CONTENT, countByStoreType([]))).toEqual([]);
  });

  it('turlerin grubu icerikten gelir: icerik degisince menu degisir, kod degismez', () => {
    const content = {
      storeTypes: CONTENT.storeTypes,
      groups: [{ label: 'Et', imageUrl: '/img/et.jpg', types: ['KASAP' as const] }],
    };

    expect(storeTypeGroups(content, countByStoreType(NEARBY)).map((group) => group.label)).toEqual([
      'Et',
    ]);
  });
});

describe('filterByStoreType', () => {
  it('tur yoksa hepsi; varsa yalnizca o tur, yakindan uzaga sira korunur', () => {
    expect(filterByStoreType(NEARBY, undefined)).toBe(NEARBY);
    expect(filterByStoreType(NEARBY, 'MARKET').map(({ market }) => market.id)).toEqual([
      'mkt_a101-caferaga',
      'mkt_migros-jet-moda',
    ]);
    expect(filterByStoreType(NEARBY, 'CICEKCI')).toEqual([]);
  });
});
