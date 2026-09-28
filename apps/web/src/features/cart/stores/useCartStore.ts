/**
 * Sepet deposu (istemci durumu -> Zustand; sunucu verisi TanStack Query'de
 * kalir, karistirilmaz). Sepet YALNIZCA tarayicida yasar (ADR-13) ve T7.6'dan
 * beri localStorage'a (`getir.cart`) yazilir: yenilemede kaybolmaz.
 *
 * Store is kurali YAZMAZ: sepet kurallari services/cart-state.ts'te, kalici
 * yazim kurallari (surum, 24 saat, dogrulama) services/cart-persistence.ts'te;
 * burada yalnizca baglanirlar.
 */

import type { Product } from '@getir/contracts';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { browserStorage } from '../../../shared/services/storage';
import type { KeyValueStorage } from '../../../shared/services/storage';
import {
  CART_STORAGE_KEY,
  CART_STORAGE_VERSION,
  DISCARDED_CART,
  restoreCart,
  toPersistedCart,
} from '../services/cart-persistence';
import {
  addItem,
  decrementItem,
  EMPTY_CART,
  removeItem,
  startNewCart,
} from '../services/cart-state';
import type { AddOutcome, CartMarket, CartState } from '../services/cart-state';

/**
 * Aksiyonlar METOT degil FONKSIYON ALANI: bilesenler onlari store'dan tek tek
 * secer (`useCartStore((c) => c.add)`); metot imzasi `this` kopmasi uyarisi
 * (unbound-method) verirdi, oysa aksiyonlar `this` kullanmaz.
 */
export interface CartActions {
  /** Bir adet ekler. Baska marketin sepeti varsa EKLEMEZ, onay ister. */
  readonly add: (product: Product, market: CartMarket) => AddOutcome;
  /** Kullanici market degisimini onayladi: sepet bosaltilir, urun eklenir. */
  readonly startNewCart: (product: Product, market: CartMarket) => void;
  /** Kalem teklif kimligiyle (offerId) tanınır; bkz. cart-state.ts. */
  readonly decrement: (offerId: string) => void;
  readonly remove: (offerId: string) => void;
  readonly clear: () => void;
}

export type CartStore = CartState & CartActions;

/** Store'un disaridan verilenleri: testte bellek ici depo ve sabit saat. */
export interface CartStoreDeps {
  /** Kalici depo; erisim hatasi Zustand'da yakalansin diye fonksiyon. */
  readonly storage: () => KeyValueStorage;
  /** Simdiki an (ms); 24 saat kurali buna bakar. */
  readonly now: () => number;
}

export function createCartStore(deps: CartStoreDeps) {
  return create<CartStore>()(
    persist(
      (set, get) => ({
        ...EMPTY_CART,
        add: (product, market) => {
          const { state, outcome } = addItem(get(), product, market);
          set(state);
          return outcome;
        },
        startNewCart: (product, market) => set(startNewCart(product, market)),
        decrement: (offerId) => set(decrementItem(get(), offerId)),
        remove: (offerId) => set(removeItem(get(), offerId)),
        clear: () => set(EMPTY_CART),
      }),
      {
        name: CART_STORAGE_KEY,
        version: CART_STORAGE_VERSION,
        storage: createJSONStorage(deps.storage),
        // Yalnizca sepet yazilir; aksiyonlar ve gecici durum degil.
        partialize: (cart) => toPersistedCart(cart, deps.now()),
        // Farkli surumlu kayit sessizce atilir (bos kayitla degistirilir).
        migrate: () => DISCARDED_CART,
        // Okunan kayit DOGRULANIR: yoksa, bozuksa ya da 24 saati gectiyse bos sepet.
        merge: (persisted, current) => ({ ...current, ...restoreCart(persisted, deps.now()) }),
      },
    ),
  );
}

/** Uygulamanin sepeti: tarayicida localStorage ve gercek saat. */
export const useCartStore = createCartStore({ storage: browserStorage, now: () => Date.now() });
