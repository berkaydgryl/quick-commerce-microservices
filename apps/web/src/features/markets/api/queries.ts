/**
 * Konuma bagli market sorgusunun ayarlari. Hook'tan ayri: istemci disaridan
 * verilir, birim testi sahte fetch'le QueryObserver uzerinden sinar (T9.5).
 */

import type { GeoPoint } from '@getir/contracts';
import { queryOptions, skipToken } from '@tanstack/react-query';

import type { HttpClient } from '../../../shared/api/http-client';
import { MARKETS_STALE_TIME_MS } from '../constants';

import { fetchNearbyMarkets } from './markets.api';
import { marketKeys } from './query-keys';

/**
 * Yakindan uzaga marketler. Konum henuz yoksa (teslimat adresi cozuluyor,
 * T9.5) istek HIC gitmez (skipToken) ve sorgu yukleniyor'da bekler: istek once
 * yanlis konuma gidip sonra degismez.
 */
export function nearbyMarketsQuery(client: HttpClient, location: GeoPoint | undefined) {
  return queryOptions({
    queryKey: marketKeys.nearby(location),
    queryFn:
      location === undefined
        ? skipToken
        : ({ signal }) => fetchNearbyMarkets(client, location, signal),
    select: (list) => list.items,
    staleTime: MARKETS_STALE_TIME_MS,
  });
}
