/**
 * Adres defteri sorgusunun ayarlari. Hook'tan ayri: istemci disaridan verilir,
 * birim testi sahte fetch'le QueryObserver uzerinden sinar.
 */

import type { GeoPoint } from '@getir/contracts';
import { queryOptions, skipToken } from '@tanstack/react-query';

import type { HttpClient } from '../../../shared/api/http-client';
import { GEO_STALE_TIME_MS, SAVED_ADDRESSES_STALE_TIME_MS } from '../constants';

import { fetchSavedAddresses } from './addresses.api';
import { reverseGeocode, searchPlaces } from './geo.api';
import { addressKeys } from './query-keys';

/**
 * Oturumdaki kullanicinin adres defteri (T9.5). Kullanici yoksa (oturumsuz)
 * istek GITMEZ (skipToken; useMarket ile ayni kalip). Elle refetch bunu
 * asamaz, sorgu "queryFn yok" hatasina duser: "Tekrar dene" yalnizca oturum
 * acikken gorunur. Istemci korumali uca gider: uygulamada yetkili istemci
 * (erisim jetonu; suresi dolmussa bir kez yenileyip tekrarlar).
 */
export function savedAddressesQuery(client: HttpClient, userId: string | null) {
  return queryOptions({
    queryKey: addressKeys.list(userId),
    queryFn: userId === null ? skipToken : ({ signal }) => fetchSavedAddresses(client, signal),
    staleTime: SAVED_ADDRESSES_STALE_TIME_MS,
    select: (list) => list.items,
  });
}

/**
 * Noktanin adres satiri (T11.8): "Bu adresi kullan"da bir kez sorulur
 * (fetchQuery). Ayni nokta tekrar sorulmaz; hata tekrar denenmez: adres yoksa
 * (404) ya da servis yogunsa (503) kullanici satiri kendisi yazar.
 */
export function reverseGeocodeQuery(client: HttpClient, point: GeoPoint) {
  return queryOptions({
    queryKey: addressKeys.reverse(point),
    queryFn: ({ signal }) => reverseGeocode(client, point, signal),
    staleTime: GEO_STALE_TIME_MS,
    retry: false,
  });
}

/**
 * Adres aramasi (T11.8). Arama metni yoksa (henuz aranmadi) istek gitmez.
 * Yazarken degil, gonderince sorulur: Nominatim saniyede bir soru kabul eder.
 */
export function placeSearchQuery(client: HttpClient, query: string | undefined) {
  return queryOptions({
    queryKey: addressKeys.search(query),
    queryFn: query === undefined ? skipToken : ({ signal }) => searchPlaces(client, query, signal),
    staleTime: GEO_STALE_TIME_MS,
    retry: false,
    select: (result) => result.items,
  });
}
