/**
 * Demo kuryeleri (T13.1): katalogdaki her markete COURIERS_PER_MARKET kurye,
 * hepsi marketin konumunda ve IDLE baslar.
 *
 * Market kimlikleri ve konumlari katalogun demo verisiyle ayni olmali
 * (catalog-service fixtures/markets.ts); test ikisini karsilastirir
 * (test/unit/courier-fixtures.spec.ts). Her servis kendi seed'ini yazar
 * (ADR-05): kurye servisi katalogu okumaz.
 *
 * Kimlikler sozlesmedeki bicimdedir (crr_<32 hex>) ve SABITTIR: market ve
 * sira numarasindan turetilir, tekrar kosan seed ayni kuryeleri yazar.
 */

import { createHash } from 'node:crypto';

import { ID_PREFIX } from '@getir/core';

import { COURIERS_PER_MARKET } from '../../config/constants.js';
import type { CourierSeed } from '../../domain/courier-seed.js';

/** Kimlik govdesinin uzunlugu (ID_PREFIX bicimi: 32 onaltilik karakter). */
const ID_BODY_LENGTH = 32;

/** Katalogun demo marketleri ve konumlari (catalog fixtures/markets.ts). */
export const MARKET_LOCATIONS: readonly {
  readonly marketId: string;
  readonly lat: number;
  readonly lng: number;
}[] = [
  { marketId: 'mkt_migros-jet-moda', lat: 40.985, lng: 29.0275 },
  { marketId: 'mkt_a101-caferaga', lat: 40.9895, lng: 29.024 },
  { marketId: 'mkt_kardesler-manavi', lat: 40.9905, lng: 29.029 },
  { marketId: 'mkt_migros-jet-besiktas', lat: 41.0425, lng: 29.008 },
  { marketId: 'mkt_carrefour-express-barbaros', lat: 41.046, lng: 29.007 },
  { marketId: 'mkt_a101-abbasaga', lat: 41.045, lng: 29.002 },
  { marketId: 'mkt_sok-moda', lat: 40.9864, lng: 29.0309 },
  { marketId: 'mkt_moda-kasabi', lat: 40.9901, lng: 29.032 },
  { marketId: 'mkt_moda-sarkuteri', lat: 40.984, lng: 29.0297 },
  { marketId: 'mkt_altiyol-kuruyemis', lat: 40.9939, lng: 29.0288 },
  { marketId: 'mkt_bahariye-firini', lat: 40.9885, lng: 29.0345 },
  { marketId: 'mkt_pati-pet-shop-kadikoy', lat: 40.9939, lng: 29.0322 },
  { marketId: 'mkt_moda-cicekcilik', lat: 40.9813, lng: 29.0297 },
  { marketId: 'mkt_bim-sinanpasa', lat: 41.0447, lng: 29.0013 },
  { marketId: 'mkt_carsi-manavi', lat: 41.0413, lng: 29.0006 },
  { marketId: 'mkt_barbaros-kasabi', lat: 41.0488, lng: 29.0071 },
  { marketId: 'mkt_besiktas-sarkuteri', lat: 41.0391, lng: 29.0007 },
  { marketId: 'mkt_yildiz-kuruyemis', lat: 41.0495, lng: 29.0102 },
  { marketId: 'mkt_abbasaga-firini', lat: 41.0478, lng: 28.9996 },
  { marketId: 'mkt_pati-pet-shop-besiktas', lat: 41.0505, lng: 29.0035 },
  { marketId: 'mkt_lale-cicekcilik', lat: 41.0416, lng: 28.996 },
];

/**
 * Istemcide gorunen adlar ("ad + soyadin bas harfi"); gercek kisi degil. Her
 * markette sirayla bir ad ve bir bas harf: 21 ad x 3 harf = 63 tekil ad.
 */
const FIRST_NAMES: readonly string[] = [
  'Mehmet',
  'Ayse',
  'Emre',
  'Zeynep',
  'Burak',
  'Elif',
  'Can',
  'Selin',
  'Hakan',
  'Deniz',
  'Murat',
  'Ece',
  'Okan',
  'Gizem',
  'Serkan',
  'Buse',
  'Tolga',
  'Irem',
  'Kerem',
  'Derya',
  'Baris',
];
const INITIALS: readonly string[] = ['K.', 'D.', 'T.'];

/** n. kuryenin adi (0'dan): ad n mod 21, bas harf n / 21; 63'e kadar tekil. */
function courierName(n: number): string {
  const first = FIRST_NAMES[n % FIRST_NAMES.length] ?? 'Kurye';
  const initial = INITIALS[Math.floor(n / FIRST_NAMES.length) % INITIALS.length] ?? '';
  return `${first} ${initial}`;
}

/** Market ve sira numarasindan sabit kimlik. */
export function courierSeedId(marketId: string, index: number): string {
  const body = createHash('sha256')
    .update(`${marketId}#${index}`)
    .digest('hex')
    .slice(0, ID_BODY_LENGTH);
  return `${ID_PREFIX.COURIER}_${body}`;
}

export const COURIER_SEEDS: readonly CourierSeed[] = MARKET_LOCATIONS.flatMap(
  (market, marketIndex) =>
    Array.from({ length: COURIERS_PER_MARKET }, (_, index) => ({
      id: courierSeedId(market.marketId, index + 1),
      name: courierName(marketIndex * COURIERS_PER_MARKET + index),
      marketId: market.marketId,
      location: { lat: market.lat, lng: market.lng },
    })),
);
