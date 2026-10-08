import type { CreateAddressRequest } from '@getir/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useAddressChangeGuard } from '../../../shared/address-change/guard';
import type { AddressChangeApproval } from '../../../shared/address-change/guard';
import { createIntentKeys } from '../../../shared/api/idempotency-key';
import { authorizedClient } from '../../../shared/session/session';
import { addSavedAddress } from '../api/addresses.api';
import { addressKeys } from '../api/query-keys';
import { useAddressStore } from '../stores/useAddressStore';

export interface AddAddressInput {
  readonly request: CreateAddressRequest;
  /** Bekci kayittan once sorulduysa izni (addMovesDelivery); yoksa kayittan sonra sorulur. */
  readonly approval?: AddressChangeApproval | undefined;
}

/**
 * Adres ekleme (T11.8): POST /v1/me/addresses. Cevap guncel defterdir; defter
 * onbellegine yazilir (yeniden okunmaz). Yeni adres, adres degisiminin
 * bekcisi izin verirse SECILIR (F16: sepetin marketi yeni adrese teslim
 * etmiyorsa sorulur; "Hayır"da adres kaydedilir ama secilmez).
 *
 * Anahtar niyet basinadir (createIntentKeys): ayni govdenin tekrari ayni
 * anahtarla gider (ikinci adres yazilmaz), duzeltilmis govde yeni anahtarla.
 */
export function useAddAddress(userId: string) {
  const queryClient = useQueryClient();
  const select = useAddressStore((state) => state.select);
  const guard = useAddressChangeGuard();
  const [keyFor] = useState(() => createIntentKeys());
  return useMutation({
    mutationFn: ({ request }: AddAddressInput) =>
      addSavedAddress(authorizedClient, request, keyFor(request)),
    onSuccess: (book, { request, approval }) => {
      queryClient.setQueryData(addressKeys.list(userId), book);
      // Ad defterde tekil: kimlik cevaptaki kayittan.
      const added = book.items.find((address) => address.title === request.title);
      if (added === undefined) return;
      const choose = (granted: AddressChangeApproval | null) => {
        if (granted === null) return;
        select({ userId, addressId: added.id });
        granted.commit();
      };
      if (approval === undefined) {
        void guard(added.location).then(choose);
      } else {
        choose(approval);
      }
    },
  });
}
