/** Adres ozelligi sabitleri (ADR-11). */

import type { GeoPoint } from '@getir/contracts';

/**
 * Varsayilan teslimat adresi: oturumsuz ziyaretci, adresi olmayan hesap ve
 * adresleri okunamayan oturum icin. Seed'deki hazir "Ev" adresidir
 * (apps/gateway/internal/persona/addresses.json, Kadikoy; bu konumda 3 market
 * hizmet verir). Oturumdaki kullanicinin adresi varsa secili adres gecerlidir
 * (T9.5). Degerin seed'le ayni kaldigini bir test denetler.
 */
export const DEFAULT_ADDRESS_TITLE = 'Ev';
export const DEFAULT_DELIVERY_LOCATION: GeoPoint = { lat: 40.9885, lng: 29.0262 };

/** Adres defteri seyrek degisir (seed ve adres ekleme penceresi yazar; ekleme onbellegi gunceller). */
export const SAVED_ADDRESSES_STALE_TIME_MS = 5 * 60 * 1000;

/** Harita adres cevaplari (T11.8): sokagin adi bir oturum boyunca degismez. */
export const GEO_STALE_TIME_MS = 30 * 60 * 1000;
