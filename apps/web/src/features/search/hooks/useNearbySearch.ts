import type { GeoPoint } from '@getir/contracts';
import { useQuery } from '@tanstack/react-query';

import { apiClient } from '../../../shared/api/client';
import { nearbySearchQuery } from '../api/queries';

/**
 * Genel arama sonuclari (sunucu verisi -> TanStack Query). Iptal, bayatlik ve
 * konum bekleme kurallari nearbySearchQuery'de.
 */
export function useNearbySearch(location: GeoPoint | undefined, query: string) {
  return useQuery(nearbySearchQuery(apiClient, location, query));
}
