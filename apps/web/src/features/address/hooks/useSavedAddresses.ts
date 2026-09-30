import { useQuery } from '@tanstack/react-query';

import { authorizedClient } from '../../../shared/session/session';
import { savedAddressesQuery } from '../api/queries';

/**
 * Oturumdaki kullanicinin adres defteri (GET /v1/me/addresses; sunucu verisi ->
 * TanStack Query). Kullanici yoksa istek gitmez (bkz. savedAddressesQuery).
 */
export function useSavedAddresses(userId: string | null) {
  return useQuery(savedAddressesQuery(authorizedClient, userId));
}
