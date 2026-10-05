import type { OrderSummary } from '@getir/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';

import { authorizedClient } from '../../../shared/session/session';
import { fetchOrderHistory, nextHistoryPage } from '../api/orders.api';
import { orderKeys } from '../api/query-keys';

/**
 * Gecmis Siparislerim (T11.16): imlecle sayfali; "Daha fazla göster" sonraki
 * sayfayi ister (fetchNextPage). Sayfalar hook icinde tek listeye
 * duzlestirilir: bilesen hesap yapmaz.
 */
export function useOrderHistory(userId: string) {
  return useInfiniteQuery({
    queryKey: orderKeys.history(userId),
    queryFn: ({ pageParam, signal }) => fetchOrderHistory(authorizedClient, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => nextHistoryPage(lastPage.page),
    select: (data): readonly OrderSummary[] => data.pages.flatMap((page) => page.items),
  });
}
