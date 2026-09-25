/**
 * Sepetin SAF is kurallari: React ve Zustand bilmez, ag ve saat yok. Store
 * yalnizca bu fonksiyonlari baglar; tasarim bastan degisse de bu dosya ve
 * testleri degismez.
 *
 * Kurallar:
 *  - TEK MARKET: sepette baska marketin urunu varken ekleme YAPILMAZ, "onay
 *    gerekiyor" doner. Onaylanirsa sepet bosaltilip yeni marketle baslanir.
 *  - Urun basina en fazla CART_ITEM_MAX_QUANTITY, sepette en fazla
 *    CART_MAX_ITEMS kalem (rezervasyon semasiyla ayni sinirlar).
 *  - Fiyat eklendigi andaki teklif fiyatidir: BILGI amaclidir, baglayici kontrol
 *    rezervasyonda yapilir (ADR-13).
 *  - Kalem TEKLIF KIMLIGIYLE (offerId) taninir, urun kimligiyle degil: ayni
 *    urunun (prd_...) her markette ayni kimligi vardir; urun kimligiyle tanimak
 *    A101 sayfasinda Migros sepetindeki adedi gosterir ve "-" Migros kalemini
 *    azaltirdi (T6.4 canli denemede bulundu). Teklif markete ozeldir (ADR-15).
 */

import { CART_ITEM_MAX_QUANTITY, CART_MAX_ITEMS } from '@getir/contracts';
import type { Product } from '@getir/contracts';

/** Sepet kalemi: urunun o marketteki teklifi + adet. Para kurus. */
export interface CartItem {
  readonly productId: Product['id'];
  readonly offerId: Product['offerId'];
  readonly sku: Product['sku'];
  readonly name: string;
  readonly unitPriceMinor: number;
  readonly quantity: number;
}

/** Sepetin ait oldugu market; onay metni icin adi da tutulur. */
export interface CartMarket {
  readonly id: string;
  readonly name: string;
}

export interface CartState {
  readonly market: CartMarket | null;
  readonly items: readonly CartItem[];
}

export const EMPTY_CART: CartState = { market: null, items: [] };

export type AddOutcome =
  | { readonly status: 'added' }
  | { readonly status: 'limit-reached'; readonly limit: 'quantity' | 'items' }
  /** Sepet baska marketin: arayuz kullaniciya sorar, onaylanirsa startNewCart. */
  | { readonly status: 'needs-confirmation'; readonly currentMarket: CartMarket };

export interface CartTransition {
  readonly state: CartState;
  readonly outcome: AddOutcome;
}

function toItem(product: Product): CartItem {
  return {
    productId: product.id,
    offerId: product.offerId,
    sku: product.sku,
    name: product.name,
    unitPriceMinor: product.price.amountMinor,
    quantity: 1,
  };
}

/** Bir adet ekler; tek market ve sinir kurallarini uygular. */
export function addItem(state: CartState, product: Product, market: CartMarket): CartTransition {
  if (state.market !== null && state.market.id !== market.id && state.items.length > 0) {
    return { state, outcome: { status: 'needs-confirmation', currentMarket: state.market } };
  }

  const existing = state.items.find((item) => item.offerId === product.offerId);
  if (existing !== undefined) {
    if (existing.quantity >= CART_ITEM_MAX_QUANTITY) {
      return { state, outcome: { status: 'limit-reached', limit: 'quantity' } };
    }
    return {
      state: withQuantity({ ...state, market }, product.offerId, existing.quantity + 1),
      outcome: { status: 'added' },
    };
  }

  if (state.items.length >= CART_MAX_ITEMS) {
    return { state, outcome: { status: 'limit-reached', limit: 'items' } };
  }
  return {
    state: { market, items: [...state.items, toItem(product)] },
    outcome: { status: 'added' },
  };
}

/** Onaylanan market degisimi: eski sepet bosaltilir, urun yeni marketle eklenir. */
export function startNewCart(product: Product, market: CartMarket): CartState {
  return addItem(EMPTY_CART, product, market).state;
}

/** Bir adet azaltir; son adet dusunce kalem kalkar, son kalem kalkinca sepet bosalir. */
export function decrementItem(state: CartState, offerId: string): CartState {
  const existing = state.items.find((item) => item.offerId === offerId);
  if (existing === undefined) {
    return state;
  }
  return existing.quantity > 1
    ? withQuantity(state, offerId, existing.quantity - 1)
    : removeItem(state, offerId);
}

export function removeItem(state: CartState, offerId: string): CartState {
  const items = state.items.filter((item) => item.offerId !== offerId);
  return items.length === 0 ? EMPTY_CART : { ...state, items };
}

/** Bu teklifin sepetteki adedi; yoksa 0. Baska marketin ayni urunu SAYILMAZ. */
export function quantityOf(state: CartState, offerId: string): number {
  return state.items.find((item) => item.offerId === offerId)?.quantity ?? 0;
}

export function itemCount(state: CartState): number {
  return state.items.reduce((sum, item) => sum + item.quantity, 0);
}

function withQuantity(state: CartState, offerId: string, quantity: number): CartState {
  return {
    ...state,
    items: state.items.map((item) => (item.offerId === offerId ? { ...item, quantity } : item)),
  };
}
