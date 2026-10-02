import { useQuery } from '@tanstack/react-query';

import { authorizedClient } from '../../../shared/session/session';
import { placeSearchQuery } from '../api/queries';

/**
 * Adres aramasi (T11.8; sunucu verisi -> TanStack Query). Arama metni yoksa
 * (henuz gonderilmedi) istek gitmez.
 */
export function usePlaceSearch(query: string | undefined) {
  return useQuery(placeSearchQuery(authorizedClient, query));
}
