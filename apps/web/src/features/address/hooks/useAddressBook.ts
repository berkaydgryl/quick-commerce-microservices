import type { SavedAddress } from '@getir/contracts';

import { useSessionStore } from '../../../shared/session/session-store';
import { addressBookState, resolveDeliveryAddress } from '../services/delivery-address';
import type { DeliveryAddressState } from '../services/delivery-address';
import { useAddressStore } from '../stores/useAddressStore';

import { useSavedAddresses } from './useSavedAddresses';

export interface AddressBook {
  /** Gecerli teslimat adresi. */
  readonly delivery: DeliveryAddressState;
  /** Secilebilir adresler, kayit sirasinda; defter yoksa bos. */
  readonly addresses: readonly SavedAddress[];
  /** Defterin hatasi; yeniden denerken null. */
  readonly error: Error | null;
  readonly retry: () => void;
  /** Adresi oturumdaki kullanici adina secer (secim kullaniciya baglidir). */
  readonly choose: (title: string) => void;
}

/**
 * Teslimat adresinin kaynaklari tek yerde (T9.5): oturum (session store),
 * adres defteri (sunucu verisi -> TanStack Query) ve secim (address store).
 * Kural hook'ta degil serviste (delivery-address.ts); hook yalnizca baglar.
 * Sayfalar konumu (useDeliveryLocation), secici hepsini kullanir.
 */
export function useAddressBook(): AddressBook {
  const session = useSessionStore((state) => state.status);
  const userId = useSessionStore((state) => state.user?.id ?? null);
  const book = useSavedAddresses(userId);
  const selection = useAddressStore((state) => state.selection);
  const select = useAddressStore((state) => state.select);

  return {
    delivery: resolveDeliveryAddress({
      session,
      userId,
      addresses: addressBookState(book),
      selection,
    }),
    addresses: book.data ?? [],
    error: book.error,
    retry: () => void book.refetch(),
    choose: (title) => {
      if (userId !== null) {
        select({ userId, title });
      }
    },
  };
}
