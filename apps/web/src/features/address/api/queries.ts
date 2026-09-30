/**
 * Adres defteri sorgusunun ayarlari. Hook'tan ayri: istemci disaridan verilir,
 * birim testi sahte fetch'le QueryObserver uzerinden sinar.
 */

import { queryOptions, skipToken } from '@tanstack/react-query';

import type { HttpClient } from '../../../shared/api/http-client';
import { SAVED_ADDRESSES_STALE_TIME_MS } from '../constants';

import { fetchSavedAddresses } from './addresses.api';
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
