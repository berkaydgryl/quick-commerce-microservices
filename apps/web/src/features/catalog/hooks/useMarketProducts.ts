import type { Product } from '@getir/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';

import { apiClient } from '../../../shared/api/client';
import { fetchMarketProducts, nextPageToken } from '../api/market-catalog.api';
import { catalogKeys } from '../api/query-keys';
import { MARKET_PRODUCTS_PAGE_SIZE } from '../constants';

/**
 * Marketin urunleri, o marketin fiyatiyla; imlecle sayfalanir ("daha fazla").
 * isPending ilk yukleme (iskelet), isFetchingNextPage sonraki sayfa sinyalidir.
 * Sayfalar hook icinde tek listeye duzlestirilir: bilesen hesap yapmaz.
 */
export function useMarketProducts(marketId: string, categoryId: string | undefined) {
  return useInfiniteQuery({
    queryKey: catalogKeys.marketProducts(marketId, categoryId),
    queryFn: ({ pageParam, signal }) =>
      fetchMarketProducts(
        apiClient,
        { marketId, categoryId, pageToken: pageParam, pageSize: MARKET_PRODUCTS_PAGE_SIZE },
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => nextPageToken(lastPage.page),
    select: (data): readonly Product[] => data.pages.flatMap((page) => page.items),
  });
}
