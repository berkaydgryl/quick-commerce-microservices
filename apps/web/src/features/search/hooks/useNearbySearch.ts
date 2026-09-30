import type { GeoPoint } from '@getir/contracts';
import { useQuery } from '@tanstack/react-query';

import { apiClient } from '../../../shared/api/client';
import { fetchNearbySearch } from '../api/search.api';
import { searchKeys } from '../api/query-keys';

/**
 * Genel arama sonuclari (sunucu verisi -> TanStack Query). Yeni arama gelince
 * eskisinin istegi signal ile iptal edilir; stok da sonuctadir, bu yuzden
 * sonuc onbellekte bayat sayilir (varsayilan).
 */
export function useNearbySearch(location: GeoPoint, query: string) {
  return useQuery({
    queryKey: searchKeys.nearby(location, query),
    queryFn: ({ signal }) => fetchNearbySearch(apiClient, location, query, signal),
    select: (list) => list.items,
  });
}
