/**
 * Sepetin tarayicida KALICI yazimi (T7.6): SAF kurallar. Depo (localStorage)
 * ve saat disaridan verilir; bu dosya ikisini de bilmez, testte sabitlenir.
 *
 * Roadmap "localStorage senkronizasyonu":
 *  - Anahtar `getir.cart`: sepet kalemleri ve secili market. Kupon alani
 *    T17.3'te eklenir (o zaman surum artar).
 *  - 24 saat: son degisiklikten 24 saat sonra kayit yok sayilir. Eski fiyatla
 *    duran bir sepet zaten rezervasyonda PRICE_CHANGED alirdi.
 *  - Surum alani: bicim degisince eski kayit SESSIZCE atilir.
 *
 * NEDEN OKUNAN KAYIT DOGRULANIR: localStorage guvenilmez girdidir. Elle
 * degistirilmis, yarim yazilmis ya da eski bicimli bir kayit sepeti bozmamali;
 * gecersiz kayit bos sepet demektir, hata degil.
 */

import {
  CART_ITEM_MAX_QUANTITY,
  CART_ITEM_MIN_QUANTITY,
  CART_MAX_ITEMS,
  marketIdSchema,
  offerIdSchema,
  productIdSchema,
  skuSchema,
} from '@getir/contracts';
import { z } from 'zod';

import { EMPTY_CART } from './cart-state';
import type { CartState } from './cart-state';

/** Roadmap'teki anahtar tablosu: `getir.` onekli. */
export const CART_STORAGE_KEY = 'getir.cart';

/** Kayit bicimi degisince artirilir; farkli surumlu kayit atilir. */
export const CART_STORAGE_VERSION = 1;

/** Son degisiklikten sonra sepetin saklandigi sure. */
export const CART_TTL_MS = 24 * 60 * 60 * 1000;

const persistedItemSchema = z.object({
  productId: productIdSchema,
  offerId: offerIdSchema,
  sku: skuSchema,
  name: z.string().min(1),
  unitPriceMinor: z.number().int().min(0),
  quantity: z.number().int().min(CART_ITEM_MIN_QUANTITY).max(CART_ITEM_MAX_QUANTITY),
});

const persistedCartSchema = z
  .object({
    /** Son yazim ani (ms). 24 saat kurali buna bakar. */
    savedAt: z.number().int().min(0),
    market: z.object({ id: marketIdSchema, name: z.string().min(1) }).nullable(),
    items: z.array(persistedItemSchema).max(CART_MAX_ITEMS),
  })
  // Sepetin kendi degismezleri: kalem varsa market vardir, teklif bir kez gecer.
  .refine(
    (cart) => cart.items.length === 0 || cart.market !== null,
    'kalemli sepetin marketi olmali',
  )
  .refine(
    (cart) => new Set(cart.items.map((item) => item.offerId)).size === cart.items.length,
    'ayni teklif iki kalem olamaz',
  );

export type PersistedCart = z.infer<typeof persistedCartSchema>;

/** Farkli surumden gelen kaydin yerine yazilan bos kayit (surum kurali). */
export const DISCARDED_CART: PersistedCart = { savedAt: 0, market: null, items: [] };

/** Depoya yazilacak bicim: yalnizca sepet, aksiyonlar ve gecici durum degil. */
export function toPersistedCart(cart: CartState, now: number): PersistedCart {
  return { savedAt: now, market: cart.market, items: [...cart.items] };
}

/**
 * Depodan okunani sepete cevirir. Kayit yoksa, bicimi bozuksa ya da 24 saati
 * gectiyse BOS sepet doner: kullanici eski ya da bozuk bir sepetle karsilasmaz.
 */
export function restoreCart(persisted: unknown, now: number): CartState {
  const parsed = persistedCartSchema.safeParse(persisted);
  if (!parsed.success || now - parsed.data.savedAt >= CART_TTL_MS) {
    return EMPTY_CART;
  }
  const { market, items } = parsed.data;
  return items.length === 0 ? EMPTY_CART : { market, items };
}

/**
 * Baska sekmenin depo olayi bu sepeti ilgilendiriyor mu? `null` anahtar tum
 * deponun temizlendigi anlamina gelir (localStorage.clear()).
 */
export function isCartStorageKey(key: string | null): boolean {
  return key === null || key === CART_STORAGE_KEY;
}
