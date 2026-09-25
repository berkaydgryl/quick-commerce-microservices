import { skipToken, useQuery } from '@tanstack/react-query';

import { apiClient } from '../../../shared/api/client';
import { fetchMarket } from '../api/markets.api';
import { marketKeys } from '../api/query-keys';
import { MARKETS_STALE_TIME_MS } from '../constants';

/**
 * Market bilgisi (puan, sure, fiyat kurallari). Kimlik yoksa sorgu HIC
 * calismaz (skipToken): bos sepetin marketi yoktur (useCartTotals).
 */
export function useMarket(marketId: string | undefined) {
  return useQuery({
    queryKey: marketKeys.detail(marketId ?? ''),
    queryFn:
      marketId === undefined ? skipToken : ({ signal }) => fetchMarket(apiClient, marketId, signal),
    staleTime: MARKETS_STALE_TIME_MS,
  });
}
