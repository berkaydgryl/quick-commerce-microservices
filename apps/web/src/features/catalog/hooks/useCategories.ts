import { useQuery } from '@tanstack/react-query';

import { apiClient } from '../../../shared/api/client';
import { fetchCategories } from '../api/categories.api';
import { catalogKeys } from '../api/query-keys';
import { CATEGORIES_STALE_TIME_MS } from '../constants';

/** Kategori listesi (sunucu verisi -> TanStack Query). Siralama sunucudadir. */
export function useCategories() {
  return useQuery({
    queryKey: catalogKeys.categories(),
    queryFn: ({ signal }) => fetchCategories(apiClient, signal),
    select: (list) => list.items,
    staleTime: CATEGORIES_STALE_TIME_MS,
  });
}
