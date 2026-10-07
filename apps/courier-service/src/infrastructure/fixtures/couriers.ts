/**
 * Demo kuryeleri (T13.1; havuz T13.2): katalogdaki her marketin YAKININA
 * DEMO_COURIERS_PER_MARKET_AREA kurye (33 x 3 = 99; Kadikoy 48, Besiktas 51).
 * Kurye markete bagli degildir; yalnizca baslangic konumu bir marketin
 * 40-150 m yakininda, belirlenimci bir noktadir. Hepsi IDLE baslar.
 *
 * Market kimlikleri ve konumlari katalogun demo verisiyle ayni olmali
 * (catalog-service fixtures/markets.ts); test ikisini karsilastirir
 * (test/unit/courier-fixtures.spec.ts). Her servis kendi seed'ini yazar
 * (ADR-05): kurye servisi katalogu okumaz, konumlarin kopyasini (markets)
 * tutar.
 *
 * Kimlikler sozlesmedeki bicimdedir (crr_<32 hex>) ve SABITTIR: market ve
 * sira numarasindan turetilir, tekrar kosan seed ayni kuryeleri yazar.
 */

import { createHash } from 'node:crypto';

import { ID_PREFIX } from '@getir/core';

import { DEMO_COURIERS_PER_MARKET_AREA } from '../../config/constants.js';
import type { GeoPoint } from '../../domain/courier.js';
import type { CourierSeed } from '../../domain/courier-seed.js';
import type { MarketLocation } from '../../domain/market-locator.js';

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
  // Urun ve magaza cesitliligi (07.10): var olan markalarin yeni subeleri.
  { marketId: 'mkt_bim-yeldegirmeni', lat: 40.9965, lng: 29.03 },
  { marketId: 'mkt_carrefour-express-kadikoy', lat: 40.9975, lng: 29.0215 },
  { marketId: 'mkt_a101-hasanpasa', lat: 40.9925, lng: 29.0395 },
  { marketId: 'mkt_sok-feneryolu', lat: 40.9815, lng: 29.0445 },
  { marketId: 'mkt_kardesler-manavi-hasanpasa', lat: 40.995, lng: 29.044 },
  { marketId: 'mkt_bahariye-firini-yeldegirmeni', lat: 40.9958, lng: 29.0335 },
  { marketId: 'mkt_sok-turkali', lat: 41.0475, lng: 28.9965 },
  { marketId: 'mkt_a101-dikilitas', lat: 41.0525, lng: 29.0045 },
  { marketId: 'mkt_migros-jet-ortakoy', lat: 41.048, lng: 29.0215 },
  { marketId: 'mkt_carrefour-express-akaretler', lat: 41.0395, lng: 28.9955 },
  { marketId: 'mkt_carsi-manavi-ortakoy', lat: 41.0495, lng: 29.0235 },
  { marketId: 'mkt_barbaros-kasabi-balmumcu', lat: 41.056, lng: 29.0095 },
];

/**
 * Istemcide gorunen adlar ("ad + soyadin bas harfi"); gercek kisi degil. Her
 * markette sirayla bir ad ve bir bas harf: 21 ad x 5 harf = 105 tekil ada (35 market)
 * (ilk 63'u T13.1'deki adlar: harfler sona eklenir).
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
const INITIALS: readonly string[] = ['K.', 'D.', 'T.', 'A.', 'S.'];

/** n. kuryenin adi (0'dan): ad n mod 21, bas harf n / 21; 105'e kadar tekil. */
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

/** Market konumu kopyasi (markets koleksiyonu): havuzun merkezleri. */
export const MARKET_LOCATION_SEEDS: readonly MarketLocation[] = MARKET_LOCATIONS.map((market) => ({
  marketId: market.marketId,
  location: { lat: market.lat, lng: market.lng },
}));

/** Baslangic noktasinin markete uzakligi (m): 40-150, kiyidaki marketlerde de karada kalsin. */
const OFFSET_MIN_METERS = 40;
const OFFSET_SPAN_METERS = 110;
const METERS_PER_DEGREE_LAT = 111_320;
/** Koordinatlar 6 ondalikla (~10 cm): seed tekrarinda ayni sayi. */
const COORDINATE_DECIMALS = 6;

/**
 * Marketten belirlenimci bir uzaklik ve yonde nokta: kimlikle ayni ozetten.
 * Yuz metrelik olcekte duz (equirectangular) yaklasim yeterli.
 */
function nearMarket(market: { lat: number; lng: number }, seedId: string): GeoPoint {
  const digest = createHash('sha256').update(`konum:${seedId}`).digest();
  const distance = OFFSET_MIN_METERS + (digest.readUInt16BE(0) % (OFFSET_SPAN_METERS + 1));
  const bearing = ((digest.readUInt16BE(2) % 360) * Math.PI) / 180;
  const dLat = (distance * Math.cos(bearing)) / METERS_PER_DEGREE_LAT;
  const dLng =
    (distance * Math.sin(bearing)) /
    (METERS_PER_DEGREE_LAT * Math.cos((market.lat * Math.PI) / 180));
  const round = (value: number): number => Number(value.toFixed(COORDINATE_DECIMALS));
  return { lat: round(market.lat + dLat), lng: round(market.lng + dLng) };
}

export const COURIER_SEEDS: readonly CourierSeed[] = MARKET_LOCATIONS.flatMap(
  (market, marketIndex) =>
    Array.from({ length: DEMO_COURIERS_PER_MARKET_AREA }, (_, index) => {
      const id = courierSeedId(market.marketId, index + 1);
      return {
        id,
        name: courierName(marketIndex * DEMO_COURIERS_PER_MARKET_AREA + index),
        location: nearMarket(market, id),
      };
    }),
);
