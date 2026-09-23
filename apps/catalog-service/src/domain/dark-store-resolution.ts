/**
 * "Bu konuma hangi depo hizmet verir?" kurali (saf).
 *
 * Sozlesme (catalog.proto, ResolveDarkStoreResponse) uc sonucu yaziya dokuyor:
 *   - yaricap icinde ve ACIK bir depo  -> o depo
 *   - yaricap icinde ama KAPALI        -> NO_STORE, sebep STORE_CLOSED
 *   - hicbir deponun yaricapinda degil -> NO_STORE + en yakin depoya mesafe
 * Kapali depo AYRI bir hata kodu degildir: kullanici acisindan sonuc aynidir
 * (siparis verilemez); fark yalnizca ayrintida tasinir.
 */

import type { DarkStore } from './catalog.js';

/** Bir deponun konuma uzakligi. */
export interface StoreDistance {
  readonly store: DarkStore;
  /** Konum ile depo merkezi arasi, metre (yuvarlanmamis). */
  readonly distanceMeters: number;
}

export type DarkStoreResolution =
  | { readonly kind: 'served'; readonly store: DarkStore; readonly distanceMeters: number }
  | { readonly kind: 'closed'; readonly nearestDistanceMeters: number }
  | { readonly kind: 'out-of-range'; readonly nearestDistanceMeters: number }
  | { readonly kind: 'no-stores' };

/**
 * @param candidates Depolar, konuma YAKINDAN UZAGA sirali (repository boyle verir).
 *
 * Birden fazla acik depo konumu kapsiyorsa EN YAKIN olan secilir: teslimat
 * suresi mesafeyle buyur. Kapsayan depolarin hepsi kapaliysa "kapali" doner -
 * kapsayan bir depo bile aciksa kullanici hizmet alir.
 */
export function resolveDarkStore(candidates: readonly StoreDistance[]): DarkStoreResolution {
  const [nearest] = candidates;
  if (nearest === undefined) {
    return { kind: 'no-stores' };
  }

  const covering = candidates.filter(
    (candidate) => candidate.distanceMeters <= candidate.store.deliveryRadiusMeters,
  );
  const served = covering.find((candidate) => candidate.store.isOpen);
  if (served !== undefined) {
    return { kind: 'served', store: served.store, distanceMeters: served.distanceMeters };
  }

  // Mesafe bilgisi EN YAKIN depoya gore verilir (UI: "en yakin depo 8,4 km").
  if (covering.length > 0) {
    return { kind: 'closed', nearestDistanceMeters: nearest.distanceMeters };
  }
  return { kind: 'out-of-range', nearestDistanceMeters: nearest.distanceMeters };
}
