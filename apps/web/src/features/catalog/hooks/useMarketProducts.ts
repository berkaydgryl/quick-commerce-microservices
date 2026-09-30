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
 *
 * Arama (T9.5) sorgu anahtarindadir: arama degisince eski sorgunun gozlemcisi
 * kalmaz ve TanStack Query onun istegini signal ile IPTAL eder (AbortController).
 */
export function useMarketProducts(
  marketId: string,
  categoryId: string | undefined,
  query?: string,
) {
  return useInfiniteQuery({
    queryKey: catalogKeys.marketProducts(marketId, categoryId, query),
    queryFn: ({ pageParam, signal }) =>
      fetchMarketProducts(
        apiClient,
        {
          marketId,
          categoryId,
          ...(query === undefined ? {} : { query }),
          pageToken: pageParam,
          pageSize: MARKET_PRODUCTS_PAGE_SIZE,
        },
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => nextPageToken(lastPage.page),
    select: (data): readonly Product[] => data.pages.flatMap((page) => page.items),
  });
}
