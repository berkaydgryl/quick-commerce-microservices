import type { GeoPoint } from '@getir/contracts';
import { useQuery } from '@tanstack/react-query';

import { apiClient } from '../../../shared/api/client';
import { nearbyMarketsQuery } from '../api/queries';

/**
 * Yakindan uzaga marketler (sunucu verisi -> TanStack Query). Bos liste =
 * "bolgende market yok". Konum yoksa istek gitmez (bkz. nearbyMarketsQuery).
 */
export function useNearbyMarkets(location: GeoPoint | undefined) {
  return useQuery(nearbyMarketsQuery(apiClient, location));
}
