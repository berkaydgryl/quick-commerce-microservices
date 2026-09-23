import { useQuery } from '@tanstack/react-query';

import { apiClient } from '../../../shared/api/client';
import { fetchMarketCategories } from '../api/market-catalog.api';
import { catalogKeys } from '../api/query-keys';
import { CATEGORIES_STALE_TIME_MS } from '../constants';

/** Marketin teklifi olan kategoriler (manav yalnizca meyve-sebze). */
export function useMarketCategories(marketId: string) {
  return useQuery({
    queryKey: catalogKeys.marketCategories(marketId),
    queryFn: ({ signal }) => fetchMarketCategories(apiClient, marketId, signal),
    select: (list) => list.items,
    staleTime: CATEGORIES_STALE_TIME_MS,
  });
}
