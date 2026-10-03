import { useQuery } from '@tanstack/react-query';

import { apiClient } from '../../../shared/api/client';
import { fetchWelcomeContent } from '../api/content.api';
import { contentKeys } from '../api/query-keys';
import { WELCOME_CONTENT_STALE_TIME_MS } from '../constants';

/**
 * Ekran icerigi (sunucu verisi -> TanStack Query; T11.6): karsilama ekrani,
 * giris ve kayit pencereleri, adres penceresi (T11.8) ve ust bar (T11.10)
 * ayni belgeden okur. Ana sayfa kapisi istegi oturum belli olmadan baslatir
 * (acilistaki sessiz yenilemeyle paralel); ust bar her sayfada kullandigi
 * icin oturum acikken de istenir.
 */
export function useWelcomeContent() {
  return useQuery({
    queryKey: contentKeys.welcome(),
    queryFn: ({ signal }) => fetchWelcomeContent(apiClient, signal),
    staleTime: WELCOME_CONTENT_STALE_TIME_MS,
  });
}
