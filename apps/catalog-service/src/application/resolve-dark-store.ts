/**
 * Use-case: konumdan hizmet veren depoyu bulur (ResolveDarkStore).
 *
 * Kural domain'de (resolveDarkStore); burasi yalnizca adaylari getirir ve
 * sonucu sozlesmedeki bicime cevirir: bulunamazsa NO_STORE.
 */

import { AppError, ERROR_CODES } from '@getir/core';

import { DARK_STORE_CANDIDATE_LIMIT } from '../config/constants.js';
import type { DarkStore } from '../domain/catalog.js';
import type { DarkStoreReader } from '../domain/dark-store-reader.js';
import { resolveDarkStore } from '../domain/dark-store-resolution.js';
import type { GeoPoint } from '../domain/geo.js';

/**
 * NO_STORE ayrintisinin anahtarlari - proto'daki ErrorDetail.metadata ile
 * AYNI adlar (catalog.proto: "reason", "nearest_distance_meters"). Degerler
 * METINDIR: ayrinti string->string tasinir, her dilde ayni gunluklensin diye.
 */
export const NO_STORE_DETAIL = {
  REASON: 'reason',
  NEAREST_DISTANCE_METERS: 'nearest_distance_meters',
} as const;

export const NO_STORE_REASON = {
  OUT_OF_RANGE: 'OUT_OF_RANGE',
  STORE_CLOSED: 'STORE_CLOSED',
  /** Katalogda hic depo yok (bos seed); UI icin "yaricap disi" ile ayni ekran. */
  NO_STORES: 'NO_STORES',
} as const;

export interface ResolveDarkStoreDeps {
  readonly darkStores: DarkStoreReader;
}

export interface ResolvedDarkStore {
  readonly store: DarkStore;
  /**
   * Metre, TAM SAYI (proto int32). Yuvarlama yaricap kuralini bozmaz: yaricap
   * tam sayi oldugu icin mesafe <= yaricap ise yuvarlanmis mesafe de <= yaricap.
   */
  readonly distanceMeters: number;
}

export type ResolveDarkStore = (location: GeoPoint) => Promise<ResolvedDarkStore>;

export function createResolveDarkStore(deps: ResolveDarkStoreDeps): ResolveDarkStore {
  return async (location) => {
    const candidates = await deps.darkStores.listDarkStoresByDistance(
      location,
      DARK_STORE_CANDIDATE_LIMIT,
    );
    const resolution = resolveDarkStore(candidates);

    switch (resolution.kind) {
      case 'served':
        return { store: resolution.store, distanceMeters: Math.round(resolution.distanceMeters) };
      case 'closed':
        throw noStore(NO_STORE_REASON.STORE_CLOSED, resolution.nearestDistanceMeters);
      case 'out-of-range':
        throw noStore(NO_STORE_REASON.OUT_OF_RANGE, resolution.nearestDistanceMeters);
      case 'no-stores':
        throw noStore(NO_STORE_REASON.NO_STORES, undefined);
    }
  };
}

function noStore(reason: string, nearestDistanceMeters: number | undefined): AppError {
  const details: Record<string, string> = { [NO_STORE_DETAIL.REASON]: reason };
  if (nearestDistanceMeters !== undefined) {
    details[NO_STORE_DETAIL.NEAREST_DISTANCE_METERS] = String(Math.round(nearestDistanceMeters));
  }
  return new AppError(ERROR_CODES.NO_STORE, 'Bu konuma hizmet veren depo yok', { details });
}
