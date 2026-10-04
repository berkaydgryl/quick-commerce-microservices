import { useQuery } from '@tanstack/react-query';

import { authorizedClient } from '../../../shared/session/session';
import { useSessionStore } from '../../../shared/session/session-store';
import { favoritesQuery } from '../api/queries';

/**
 * Oturumdaki kullanicinin favorileri (sunucu verisi -> TanStack Query;
 * T11.13). Oturum yoksa istek gitmez.
 */
export function useFavorites() {
  const userId = useSessionStore((state) => state.user?.id ?? null);
  return useQuery(favoritesQuery(authorizedClient, userId));
}
