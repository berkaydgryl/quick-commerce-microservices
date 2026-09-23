import { useQuery } from '@tanstack/react-query';

import { apiClient } from '../../../shared/api/client';
import { fetchMarket } from '../api/markets.api';
import { marketKeys } from '../api/query-keys';
import { MARKETS_STALE_TIME_MS } from '../constants';

/** Market sayfasinin basligi (puan, sure, fiyat kurallari). */
export function useMarket(marketId: string) {
  return useQuery({
    queryKey: marketKeys.detail(marketId),
    queryFn: ({ signal }) => fetchMarket(apiClient, marketId, signal),
    staleTime: MARKETS_STALE_TIME_MS,
  });
}
