import type { SavedCardList } from '@getir/contracts';
import { AppError, ERROR_CODES } from '@getir/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type { HttpClient } from '../../../shared/api/http-client';
import { createIntentKeys } from '../../../shared/api/idempotency-key';
import { authorizedClient } from '../../../shared/session/session';
import { deleteCard } from '../api/cards.api';
import { cardKeys } from '../api/query-keys';

/**
 * Karti siler; kart baska cihazda zaten silinmisse (404) null: silme BASARI
 * sayilir, liste yeniden okunur (QA C6). Diger hatalar firlatilir.
 */
export async function removeCard(
  client: HttpClient,
  cardId: string,
  idempotencyKey: string,
): Promise<SavedCardList | null> {
  try {
    return await deleteCard(client, cardId, idempotencyKey);
  } catch (error) {
    if (error instanceof AppError && error.code === ERROR_CODES.NOT_FOUND) {
      return null;
    }
    throw error;
  }
}

/**
 * Silmenin sonucu onbellege: guncel liste yazilir; kart zaten silinmisse
 * (null) liste yeniden okunur, baska cihazdaki degisiklik de gelir (QA C6).
 */
export async function applyDeletedList(
  queryClient: QueryClient,
  userId: string,
  list: SavedCardList | null,
): Promise<void> {
  if (list === null) {
    await queryClient.invalidateQueries({ queryKey: cardKeys.list(userId) });
    return;
  }
  queryClient.setQueryData(cardKeys.list(userId), list);
}

/**
 * Kart silme (T11.17): DELETE /v1/me/cards/{cardId}. Cevap guncel listedir;
 * onbellege yazilir; zaten silinmis kartta (removeCard null) liste yeniden
 * okunur. Niyet anahtari yalnizca kart kimliginden (gizli veri degil).
 */
export function useDeleteCard(userId: string) {
  const queryClient = useQueryClient();
  const [keyFor] = useState(() => createIntentKeys());
  return useMutation({
    mutationFn: (cardId: string) =>
      removeCard(authorizedClient, cardId, keyFor({ delete: cardId })),
    onSuccess: (list) => applyDeletedList(queryClient, userId, list),
  });
}
