/**
 * Sepet ve rezervasyon uclarinin semalari:
 *   POST   /v1/cart/reserve
 *   DELETE /v1/cart/reserve/{orderId}
 *
 * Sepetin kendisi SUNUCUDA TUTULMAZ (ADR-13): tarayicida yasar ve yalnizca
 * rezervasyon aninda sunucuya gelir. Bu yuzden burada "sepete ekle" gibi bir
 * uc yoktur; sepet tek seferde rezerve edilir.
 */

import { z } from 'zod';

import { idSchema, isoDateTimeSchema, moneySchema } from './common.js';
import {
  CART_ITEM_MAX_QUANTITY,
  CART_ITEM_MIN_QUANTITY,
  CART_MAX_ITEMS,
  CART_MIN_ITEMS,
} from './constants.js';

/**
 * Sepet satiri girdisi.
 *
 * FIYAT TASIMAZ. Istemcinin gonderdigi fiyata guvenmek, sepeti duzenleyip
 * bedava siparis acmaya izin verirdi; tutarlar sunucuda katalog fiyatindan
 * hesaplanir.
 */
export const cartItemInputSchema = z.object({
  productId: idSchema,
  quantity: z.number().int().min(CART_ITEM_MIN_QUANTITY).max(CART_ITEM_MAX_QUANTITY),
});

export const reserveCartRequestSchema = z.object({
  darkStoreId: idSchema,
  items: z.array(cartItemInputSchema).min(CART_MIN_ITEMS).max(CART_MAX_ITEMS),
});

/** Rezerve edilmis, fiyati DONDURULMUS satir. */
export const reservationLineSchema = z.object({
  productId: idSchema,
  name: z.string(),
  quantity: z.number().int().min(CART_ITEM_MIN_QUANTITY),
  unitPrice: moneySchema,
  /** unitPrice * quantity. Istemcide tekrar carpilmasin diye tasinir. */
  lineTotal: moneySchema,
});

export const reservationSchema = z.object({
  /** Rezervasyonun ve ondan dogacak siparisin ORTAK kimligi. */
  orderId: idSchema,
  darkStoreId: idSchema,
  lines: z.array(reservationLineSchema),
  subtotal: moneySchema,
  deliveryFee: moneySchema.optional(),
  total: moneySchema.optional(),
  /** Geri sayimin bitecegi an (UTC). */
  expiresAt: isoDateTimeSchema,
  /**
   * Rezervasyon suresi. Varsayilan RESERVATION_TTL_SECONDS; risk orta
   * seviyedeyse RESERVATION_TTL_MEDIUM_RISK_SECONDS uygulanir. Deger sunucudan
   * gelir, istemci hesaplamaz.
   */
  ttlSeconds: z.number().int().positive(),
});

/**
 * Rezervasyon serbest birakma cevabi.
 *
 * released alani false olabilir ve bu HATA DEGILDIR: rezervasyon zaten
 * suresi dolup supurucu tarafindan toplanmis olabilir. Istemci her iki
 * durumda da sepeti tazeler.
 */
export const reservationReleaseSchema = z.object({
  orderId: idSchema,
  released: z.boolean(),
  releasedAt: isoDateTimeSchema,
});

export type CartItemInput = z.infer<typeof cartItemInputSchema>;
export type ReserveCartRequest = z.infer<typeof reserveCartRequestSchema>;
export type ReservationLine = z.infer<typeof reservationLineSchema>;
export type Reservation = z.infer<typeof reservationSchema>;
export type ReservationRelease = z.infer<typeof reservationReleaseSchema>;
