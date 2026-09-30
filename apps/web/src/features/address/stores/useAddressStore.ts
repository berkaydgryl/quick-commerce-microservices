/**
 * Secili teslimat adresi deposu (istemci durumu -> Zustand; adres defterinin
 * kendisi sunucu verisidir, TanStack Query'de kalir). `getir.address`'e yazilir:
 * yenilemede ve yeniden giriste secim korunur (T9.5).
 *
 * Store kural YAZMAZ: kalici yazim kurallari (surum, dogrulama)
 * services/address-selection.ts'te, hangi adresin gecerli oldugu
 * services/delivery-address.ts'te; burada yalnizca baglanirlar.
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { browserStorage } from '../../../shared/services/storage';
import type { KeyValueStorage } from '../../../shared/services/storage';
import {
  ADDRESS_STORAGE_KEY,
  ADDRESS_STORAGE_VERSION,
  DISCARDED_ADDRESS,
  restoreSelection,
} from '../services/address-selection';
import type { AddressSelection, PersistedAddress } from '../services/address-selection';

export interface AddressState {
  readonly selection: AddressSelection | null;
}

/** Aksiyon FONKSIYON ALANI (metot degil): bilesen tek basina secer (bkz. useCartStore). */
export interface AddressActions {
  readonly select: (selection: AddressSelection) => void;
}

export type AddressStore = AddressState & AddressActions;

/** Store'un disaridan verilenleri: testte bellek ici depo. */
export interface AddressStoreDeps {
  /** Kalici depo; erisim hatasi Zustand'da yakalansin diye fonksiyon. */
  readonly storage: () => KeyValueStorage;
}

export function createAddressStore(deps: AddressStoreDeps) {
  return create<AddressStore>()(
    persist(
      (set) => ({
        selection: null,
        select: (selection) => set({ selection }),
      }),
      {
        name: ADDRESS_STORAGE_KEY,
        version: ADDRESS_STORAGE_VERSION,
        storage: createJSONStorage(deps.storage),
        // Yalnizca secim yazilir; aksiyonlar degil.
        partialize: (store): PersistedAddress => ({ selection: store.selection }),
        // Farkli surumlu kayit sessizce atilir.
        migrate: () => DISCARDED_ADDRESS,
        // Okunan kayit DOGRULANIR: yoksa ya da bozuksa secim yoktur.
        merge: (persisted, current) => ({ ...current, selection: restoreSelection(persisted) }),
      },
    ),
  );
}

/** Uygulamanin secimi: tarayicida localStorage. */
export const useAddressStore = createAddressStore({ storage: browserStorage });
