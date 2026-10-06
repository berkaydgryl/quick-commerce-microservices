import type { AddCardRequest, SavedCard, SavedCardList } from '@getir/contracts';
import { useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import type { HttpClient } from '../../../shared/api/http-client';
import { authorizedClient } from '../../../shared/session/session';
import { addCard } from '../api/cards.api';
import { cardKeys } from '../api/query-keys';
import { createAttemptKeys } from '../services/attempt-key';
import type { AttemptKeys } from '../services/attempt-key';

interface SaveCardInput {
  readonly client: HttpClient;
  readonly queryClient: QueryClient;
  readonly userId: string;
  readonly attempts: AttemptKeys;
  readonly request: AddCardRequest;
}

/**
 * Karti kaydeder ve listenin onbellegine yalnizca CEVABI (maskeli kart) yazar.
 * Istek (numara, CVV) hicbir onbellege girmez (M7): bu yuzden useMutation
 * DEGIL; mutasyon onbellegi degiskenleri (istegin kendisini) saklardi.
 */
export async function saveCard({
  client,
  queryClient,
  userId,
  attempts,
  request,
}: SaveCardInput): Promise<SavedCard> {
  try {
    const card = await addCard(client, request, attempts.current());
    attempts.settle();
    queryClient.setQueryData<SavedCardList>(cardKeys.list(userId), (list) =>
      list === undefined ? undefined : { items: [card, ...list.items] },
    );
    await queryClient.invalidateQueries({ queryKey: cardKeys.list(userId) });
    return card;
  } catch (error) {
    attempts.settle(error);
    throw error;
  }
}

/**
 * Kart ekleme (T11.17): POST /v1/me/cards. Anahtar rastgele ve denemeye
 * bagli (services/attempt-key.ts): sonucu belirsiz deneme ayni anahtarla
 * tekrarlanir. Bekleme durumunu form tutar (isSubmitting).
 */
export function useAddCard(userId: string) {
  const queryClient = useQueryClient();
  const [attempts] = useState(() => createAttemptKeys());
  return useCallback(
    (request: AddCardRequest) =>
      saveCard({ client: authorizedClient, queryClient, userId, attempts, request }),
    [attempts, queryClient, userId],
  );
}
