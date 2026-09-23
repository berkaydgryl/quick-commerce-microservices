import type { GeoPoint } from '@getir/contracts';
import { useQuery } from '@tanstack/react-query';

import { apiClient } from '../../../shared/api/client';
import { fetchNearbyMarkets } from '../api/markets.api';
import { marketKeys } from '../api/query-keys';
import { MARKETS_STALE_TIME_MS } from '../constants';

/** Yakindan uzaga marketler (sunucu verisi -> TanStack Query). Bos liste = "bolgende market yok". */
export function useNearbyMarkets(location: GeoPoint) {
  return useQuery({
    queryKey: marketKeys.nearby(location),
    queryFn: ({ signal }) => fetchNearbyMarkets(apiClient, location, signal),
    select: (list) => list.items,
    staleTime: MARKETS_STALE_TIME_MS,
  });
}
