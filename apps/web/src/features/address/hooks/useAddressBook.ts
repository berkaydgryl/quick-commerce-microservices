import type { SavedAddress } from '@getir/contracts';
import { useEffect } from 'react';

import { KEEP_CART, useAddressChangeGuard } from '../../../shared/address-change/guard';
import { useSessionStore } from '../../../shared/session/session-store';
import { upgradeSelection } from '../services/address-selection';
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
  /**
   * Adresi (kimligiyle) oturumdaki kullanici adina secer (secim kullaniciya
   * baglidir). Once adres degisiminin bekcisi sorulur (F16: sepetin marketi
   * yeni adrese teslim etmiyorsa onay); gecerli adres yeniden secilirse
   * sorulmaz. true: adres secildi.
   */
  readonly choose: (addressId: string) => Promise<boolean>;
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
  const guard = useAddressChangeGuard();

  // Surum 1'den tasinmis adla secim: defter gelince kimlige cevrilir (K3 (a)).
  // Etki ilkel degerlere baglidir: her cizimde yeni nesne etkiyi yeniden kosturmasin.
  const upgraded = upgradeSelection(selection, userId, book.data ?? []);
  const upgradeUserId = upgraded?.userId;
  const upgradeAddressId = upgraded?.addressId;
  useEffect(() => {
    if (upgradeUserId !== undefined && upgradeAddressId !== undefined) {
      select({ userId: upgradeUserId, addressId: upgradeAddressId });
    }
  }, [upgradeUserId, upgradeAddressId, select]);

  const delivery = resolveDeliveryAddress({
    session,
    userId,
    addresses: addressBookState(book),
    selection,
  });
  const currentId =
    delivery.status === 'ready' && delivery.source === 'account' ? delivery.addressId : undefined;

  return {
    delivery,
    addresses: book.data ?? [],
    error: book.error,
    retry: () => void book.refetch(),
    choose: async (addressId) => {
      const address = book.data?.find((item) => item.id === addressId);
      if (userId === null || address === undefined) {
        return false;
      }
      const approval = addressId === currentId ? KEEP_CART : await guard(address.location);
      if (approval === null) {
        return false;
      }
      select({ userId, addressId });
      approval.commit();
      return true;
    },
  };
}
