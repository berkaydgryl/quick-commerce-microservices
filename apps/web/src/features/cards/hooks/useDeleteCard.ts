import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { createIntentKeys } from '../../../shared/api/idempotency-key';
import { authorizedClient } from '../../../shared/session/session';
import { deleteCard } from '../api/cards.api';
import { cardKeys } from '../api/query-keys';

/**
 * Kart silme (T11.17): DELETE /v1/me/cards/{cardId}. Cevap guncel listedir;
 * onbellege yazilir. Niyet anahtari yalnizca kart kimliginden (gizli veri
 * degil); ayni kartin ikinci denemesi ayni anahtarla gider.
 */
export function useDeleteCard(userId: string) {
  const queryClient = useQueryClient();
  const [keyFor] = useState(() => createIntentKeys());
  return useMutation({
    mutationFn: (cardId: string) =>
      deleteCard(authorizedClient, cardId, keyFor({ delete: cardId })),
    onSuccess: (list) => {
      queryClient.setQueryData(cardKeys.list(userId), list);
    },
  });
}
