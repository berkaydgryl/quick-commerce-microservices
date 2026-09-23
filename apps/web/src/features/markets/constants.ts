/** Markets ozelligi sabitleri (ADR-11). */

import type { GeoPoint } from '@getir/contracts';

/**
 * Teslimat konumu, adres secimi gelene kadar (T9.5) SABIT: seed'deki hazir
 * "Ev" adresi (infra/seed/data/addresses.json, Kadikoy). Bu konumda 3 market
 * hizmet verir. Adres secimi geldiginde bu sabit kalkar, konum istemci
 * durumundan (Zustand) gelir.
 */
export const DEFAULT_DELIVERY_LOCATION: GeoPoint = { lat: 40.9885, lng: 29.0262 };

/** Market bilgisi (puan, sure, kurallar) seyrek degisir. */
export const MARKETS_STALE_TIME_MS = 60 * 1000;
