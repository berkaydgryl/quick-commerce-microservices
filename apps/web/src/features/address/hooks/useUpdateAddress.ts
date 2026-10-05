import type { UpdateAddressRequest } from '@getir/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { createIntentKeys } from '../../../shared/api/idempotency-key';
import { authorizedClient } from '../../../shared/session/session';
import { updateSavedAddress } from '../api/addresses.api';
import { addressKeys } from '../api/query-keys';

/** Duzenlenen adres: kimligi ve tam govdesi. */
export interface AddressUpdate {
  readonly addressId: string;
  readonly request: UpdateAddressRequest;
}

/**
 * Adres duzenleme (T11.15): PUT /v1/me/addresses/{addressId}. Cevap guncel
 * defterdir; defter onbellegine yazilir. Secim kimliktir: ad degisse de
 * secili adres secili kalir.
 *
 * Anahtar niyet basinadir (createIntentKeys): ayni duzenlemenin tekrari ayni
 * anahtarla gider, duzeltilmis govde yeni anahtarla.
 */
export function useUpdateAddress(userId: string) {
  const queryClient = useQueryClient();
  const [keyFor] = useState(() => createIntentKeys());
  return useMutation({
    mutationFn: (update: AddressUpdate) =>
      updateSavedAddress(authorizedClient, update.addressId, update.request, keyFor(update)),
    onSuccess: (book) => {
      queryClient.setQueryData(addressKeys.list(userId), book);
    },
  });
}
