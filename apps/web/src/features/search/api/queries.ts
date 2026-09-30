/**
 * Genel arama sorgusunun ayarlari. Hook'tan ayri: istemci disaridan verilir,
 * birim testi sahte fetch'le QueryObserver uzerinden sinar (T9.5).
 */

import type { GeoPoint } from '@getir/contracts';
import { queryOptions, skipToken } from '@tanstack/react-query';

import type { HttpClient } from '../../../shared/api/http-client';

import { searchKeys } from './query-keys';
import { fetchNearbySearch } from './search.api';

/**
 * Yakindaki marketlerde arama. Yeni arama gelince eskisinin istegi signal ile
 * iptal edilir; stok da sonuctadir, bu yuzden sonuc onbellekte bayat sayilir
 * (varsayilan). Konum henuz yoksa (teslimat adresi cozuluyor, T9.5) istek HIC
 * gitmez (skipToken).
 */
export function nearbySearchQuery(
  client: HttpClient,
  location: GeoPoint | undefined,
  query: string,
) {
  return queryOptions({
    queryKey: searchKeys.nearby(location, query),
    queryFn:
      location === undefined
        ? skipToken
        : ({ signal }) => fetchNearbySearch(client, location, query, signal),
    select: (list) => list.items,
  });
}
