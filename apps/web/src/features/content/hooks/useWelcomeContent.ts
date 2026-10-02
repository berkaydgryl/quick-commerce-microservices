import { useQuery } from '@tanstack/react-query';

import { apiClient } from '../../../shared/api/client';
import { fetchWelcomeContent } from '../api/content.api';
import { contentKeys } from '../api/query-keys';
import { WELCOME_CONTENT_STALE_TIME_MS } from '../constants';

/**
 * Karsilama ekraninin icerigi (sunucu verisi -> TanStack Query; T11.6).
 * enabled: ana sayfa kapisi oturum belli olmadan istegi baslatir (acilistaki
 * sessiz yenilemeyle paralel), oturum aciksa hic istemez.
 */
export function useWelcomeContent(enabled = true) {
  return useQuery({
    queryKey: contentKeys.welcome(),
    queryFn: ({ signal }) => fetchWelcomeContent(apiClient, signal),
    staleTime: WELCOME_CONTENT_STALE_TIME_MS,
    enabled,
  });
}
