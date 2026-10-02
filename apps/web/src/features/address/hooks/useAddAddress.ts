import type { CreateAddressRequest } from '@getir/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { createIntentKeys } from '../../../shared/api/idempotency-key';
import { authorizedClient } from '../../../shared/session/session';
import { addSavedAddress } from '../api/addresses.api';
import { addressKeys } from '../api/query-keys';
import { useAddressStore } from '../stores/useAddressStore';

/**
 * Adres ekleme (T11.8): POST /v1/me/addresses. Cevap guncel defterdir; defter
 * onbellegine yazilir (yeniden okunmaz) ve yeni adres SECILIR: ana sayfa
 * marketleri hemen o konumla sorar.
 *
 * Anahtar niyet basinadir (createIntentKeys): ayni govdenin tekrari ayni
 * anahtarla gider (ikinci adres yazilmaz), duzeltilmis govde yeni anahtarla.
 */
export function useAddAddress(userId: string) {
  const queryClient = useQueryClient();
  const select = useAddressStore((state) => state.select);
  const [keyFor] = useState(() => createIntentKeys());
  return useMutation({
    mutationFn: (request: CreateAddressRequest) =>
      addSavedAddress(authorizedClient, request, keyFor(request)),
    onSuccess: (book, request) => {
      queryClient.setQueryData(addressKeys.list(userId), book);
      select({ userId, title: request.title });
    },
  });
}
