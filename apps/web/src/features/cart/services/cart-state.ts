/**
 * Sepetin SAF is kurallari: React ve Zustand bilmez, ag ve saat yok. Store
 * yalnizca bu fonksiyonlari baglar; tasarim bastan degisse de bu dosya ve
 * testleri degismez.
 *
 * Kurallar:
 *  - TEK MARKET: sepette baska marketin urunu varken ekleme YAPILMAZ, "onay
 *    gerekiyor" doner. Onaylanirsa sepet bosaltilip yeni marketle baslanir.
 *  - Urun basina en fazla CART_ITEM_MAX_QUANTITY, sepette en fazla
 *    CART_MAX_ITEMS kalem (rezervasyon semasiyla ayni sinirlar). Stok bilgisi
 *    geldiyse (availableQuantity) sinir stoktur (T7.6, stok siniri on
 *    kontrolu). Stok T8.4'ten beri gelir; stok servisi cevap vermezse alan
 *    gelmez ve sinir yine platform sinirdir. Stogu 0 olan teklif "tukendi"dir
 *    (isSoldOut).
 *  - Satista olmayan teklif (isActive false) EKLENMEZ (T7.6). Baglayici karar
 *    yine rezervasyondadir; bu kural kullaniciyi bosuna ugrastirmamak icindir.
 *  - "Eklenebilir mi" sorusunun TEK cevabi canAdd'dir: arayuz dugmeyi buna gore
 *    acar, siniri kendisi hesaplamaz (D11).
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
  /** Teklif satista degil (isActive false). */
  | { readonly status: 'unavailable' }
  | { readonly status: 'limit-reached'; readonly limit: 'quantity' | 'stock' | 'items' }
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

/** Urun basina adet siniri: stok bilgisi varsa ve daha azsa stok, yoksa platform siniri. */
function quantityLimitOf(product: Product): {
  readonly max: number;
  readonly limit: 'quantity' | 'stock';
} {
  const stock = product.availableQuantity;
  return stock !== undefined && stock < CART_ITEM_MAX_QUANTITY
    ? { max: stock, limit: 'stock' }
    : { max: CART_ITEM_MAX_QUANTITY, limit: 'quantity' };
}

/** Bu urunden bir adet daha eklemeyi engelleyen kural; yoksa undefined. */
function blockerOf(state: CartState, product: Product): AddOutcome | undefined {
  if (!product.isActive) {
    return { status: 'unavailable' };
  }
  const quantity = quantityOf(state, product.offerId);
  const { max, limit } = quantityLimitOf(product);
  if (quantity >= max) {
    return { status: 'limit-reached', limit };
  }
  if (quantity === 0 && state.items.length >= CART_MAX_ITEMS) {
    return { status: 'limit-reached', limit: 'items' };
  }
  return undefined;
}

/** Baska marketin dolu sepeti varken ekleme onay ister (tek market kurali). */
function isSwitching(state: CartState, market: CartMarket): boolean {
  return state.market !== null && state.market.id !== market.id && state.items.length > 0;
}

/**
 * Teklif tukendi mi (T8.4)? Stok bilgisi GELDIYSE ve 0 ise. Stok bilgisi yoksa
 * ("stok bilgisi yok") tukenmis SAYILMAZ: sinir platform siniridir, baglayici
 * kontrol rezervasyondadir. Pasif teklif tukendi degil "satista degil"dir
 * (isActive): ikisi birlikteyse arayuz "Satista degil" gosterir.
 */
export function isSoldOut(product: Product): boolean {
  return product.isActive && product.availableQuantity === 0;
}

/**
 * Bu urunden bir adet daha eklenebilir mi? Arayuzun "Ekle" ve "+" icin TEK
 * sorusu. Urun baska marketinse sinirlar BOS sepete gore sorulur: ekleme onayla
 * yeni sepette yapilacaktir.
 */
export function canAdd(state: CartState, product: Product): boolean {
  const cart = state.market?.id === product.marketId ? state : EMPTY_CART;
  return blockerOf(cart, product) === undefined;
}

/**
 * Bir adet ekler; satis, sinir ve tek market kurallarini uygular. Urun
 * eklenemiyorsa market degisimi HIC sorulmaz: onaydan sonra eklenemeyecek bir
 * urun icin sepeti bosaltmak kullaniciyi cezalandirirdi.
 */
export function addItem(state: CartState, product: Product, market: CartMarket): CartTransition {
  const switching = isSwitching(state, market);
  const blocker = blockerOf(switching ? EMPTY_CART : state, product);
  if (blocker !== undefined) {
    return { state, outcome: blocker };
  }
  if (switching && state.market !== null) {
    return { state, outcome: { status: 'needs-confirmation', currentMarket: state.market } };
  }

  const existing = state.items.find((item) => item.offerId === product.offerId);
  if (existing !== undefined) {
    return {
      state: withQuantity({ ...state, market }, product.offerId, existing.quantity + 1),
      outcome: { status: 'added' },
    };
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

/** Kalemin tutari (birim fiyat x adet), KURUS; gosterim icindir, toplam @getir/pricing'tedir. */
export function lineTotalMinor(item: CartItem): number {
  return item.unitPriceMinor * item.quantity;
}

function withQuantity(state: CartState, offerId: string, quantity: number): CartState {
  return {
    ...state,
    items: state.items.map((item) => (item.offerId === offerId ? { ...item, quantity } : item)),
  };
}
