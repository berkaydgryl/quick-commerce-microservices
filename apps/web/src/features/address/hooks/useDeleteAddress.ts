import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { createIntentKeys } from '../../../shared/api/idempotency-key';
import { authorizedClient } from '../../../shared/session/session';
import { deleteSavedAddress } from '../api/addresses.api';
import { addressKeys } from '../api/query-keys';

/**
 * Adres silme (T11.15): DELETE /v1/me/addresses/{addressId}. Cevap guncel
 * defterdir; defter onbellegine yazilir. Secili adres silinirse secim
 * defterde bulunamaz ve gecerli adres defterin ILK adresi olur (K6;
 * delivery-address.ts); ayrica secim yazilmaz.
 */
export function useDeleteAddress(userId: string) {
  const queryClient = useQueryClient();
  const [keyFor] = useState(() => createIntentKeys());
  return useMutation({
    mutationFn: (addressId: string) =>
      deleteSavedAddress(authorizedClient, addressId, keyFor({ delete: addressId })),
    onSuccess: (book) => {
      queryClient.setQueryData(addressKeys.list(userId), book);
    },
  });
}
