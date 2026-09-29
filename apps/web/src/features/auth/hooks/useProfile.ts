import { useQuery } from '@tanstack/react-query';

import { authorizedClient } from '../../../shared/session/session';
import { fetchProfile } from '../api/auth.api';
import { authKeys } from '../api/query-keys';

/**
 * Oturumdaki kullanicinin profili (GET /v1/me). Erisim jetonunun suresi
 * dolmussa yetkili istemci bir kez yeniler ve tekrarlar (authorized-client.ts).
 */
export function useProfile(userId: string) {
  return useQuery({
    queryKey: authKeys.profile(userId),
    queryFn: ({ signal }) => fetchProfile(authorizedClient, signal),
  });
}
