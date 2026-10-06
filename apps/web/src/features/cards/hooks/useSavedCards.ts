import { useQuery } from '@tanstack/react-query';

import { authorizedClient } from '../../../shared/session/session';
import { fetchSavedCards } from '../api/cards.api';
import { cardKeys } from '../api/query-keys';

/** Kayitli kartlar (T11.17): GET /v1/me/cards; onbellekte yalnizca maskeli liste. */
export function useSavedCards(userId: string) {
  return useQuery({
    queryKey: cardKeys.list(userId),
    queryFn: ({ signal }) => fetchSavedCards(authorizedClient, signal),
    select: (list) => list.items,
  });
}
