import type { FavoritesContent, Market } from '@getir/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { createIdempotencyKey } from '../../../shared/api/idempotency-key';
import { authorizedClient } from '../../../shared/session/session';
import { useSessionStore } from '../../../shared/session/session-store';
import { useToastStore } from '../../../shared/toast/toast-store';
import { addFavorite, removeFavorite } from '../api/favorites.api';
import { favoriteToggleOptions } from '../services/favorite-toggle';

/** Bildirim metinleri (icerikten). */
type ToggleTexts = Pick<FavoritesContent, 'updateFailedToast' | 'listFullToast'>;

/**
 * Bir marketin kalbi (T11.13): iyimser, market basina sirali, hata olursa o
 * marketin ogesi geri alinir ve bildirim cikar (kurallar favoriteToggleOptions'ta).
 * Her tiklama yeni bir niyettir: kendi Idempotency-Key'iyle gider; ag
 * tekrarlari ayni anahtari tasir.
 */
export function useToggleFavorite(market: Market, texts: ToggleTexts) {
  const queryClient = useQueryClient();
  const userId = useSessionStore((state) => state.user?.id ?? null);
  const notify = useToastStore((state) => state.show);

  return useMutation(
    favoriteToggleOptions({
      queryClient,
      userId,
      market,
      texts,
      notify,
      add: (marketId) => addFavorite(authorizedClient, marketId, createIdempotencyKey()),
      remove: (marketId) => removeFavorite(authorizedClient, marketId, createIdempotencyKey()),
      now: () => new Date().toISOString(),
    }),
  );
}
