/**
 * Sepet deposu (istemci durumu -> Zustand; sunucu verisi TanStack Query'de
 * kalir, karistirilmaz). Sepet YALNIZCA tarayicida yasar (ADR-13); kalici
 * yazim (localStorage) T7.6'da eklenir, o zamana kadar yenilemede sifirlanir.
 *
 * Store is kurali YAZMAZ: services/cart-state.ts'teki saf fonksiyonlari baglar.
 */

import type { Product } from '@getir/contracts';
import { create } from 'zustand';

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

export const useCartStore = create<CartStore>()((set, get) => ({
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
}));
