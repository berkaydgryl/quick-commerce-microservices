import { queryOptions, skipToken } from '@tanstack/react-query';

import type { HttpClient } from '../../../shared/api/http-client';
import { FAVORITES_STALE_TIME_MS } from '../constants';

import { fetchFavorites } from './favorites.api';
import { favoriteKeys } from './query-keys';

/**
 * Oturumdaki kullanicinin favorileri (T11.13). Kullanici yoksa istek GITMEZ
 * (skipToken; adres defteriyle ayni kalip). Kart kalpleri ve favori sayfasi
 * ayni sorguyu okur: tek istek.
 */
export function favoritesQuery(client: HttpClient, userId: string | null) {
  return queryOptions({
    queryKey: favoriteKeys.list(userId),
    queryFn: userId === null ? skipToken : ({ signal }) => fetchFavorites(client, signal),
    staleTime: FAVORITES_STALE_TIME_MS,
  });
}
