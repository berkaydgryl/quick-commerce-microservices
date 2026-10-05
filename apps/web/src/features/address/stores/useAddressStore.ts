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
  migrateAddress,
  restoreSelection,
} from '../services/address-selection';
import type {
  AddressSelection,
  PersistedAddress,
  StoredSelection,
} from '../services/address-selection';

export interface AddressState {
  /** Kimlikle secim; surum 1'den tasinmis kayitta cevrilene kadar adla. */
  readonly selection: StoredSelection | null;
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
        // Surum 1'in adla secimi tasinir (T11.15, K3); baska surum atilir.
        migrate: migrateAddress,
        // Okunan kayit DOGRULANIR: yoksa ya da bozuksa secim yoktur.
        merge: (persisted, current) => ({ ...current, selection: restoreSelection(persisted) }),
      },
    ),
  );
}

/** Uygulamanin secimi: tarayicida localStorage. */
export const useAddressStore = createAddressStore({ storage: browserStorage });
