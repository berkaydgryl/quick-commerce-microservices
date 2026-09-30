/**
 * gRPC istek semalari (Zod; ADR-10).
 *
 * Market kimligi sozlesmenin bicimindedir (@getir/contracts). SKU listesi en
 * fazla MAX_AVAILABILITY_SKUS; bos SKU reddedilir. SKU BICIMI BILEREK ESNEK:
 * bicimi bozuk ama dolu SKU reddedilmez, `unknownSkus`'ta doner - toplu
 * okumada tek hatali kalem butun listeyi dusurmemeli (catalog BatchGetOffers
 * ile ayni kural). Bos liste gecerlidir (bos cevap).
 *
 * dark_store_id (ADR-15 oncesi alan) okunmaz: servis yeni, eski istemcisi yok.
 */

import { CART_ITEM_MAX_QUANTITY, CART_MAX_ITEMS, marketIdSchema } from '@getir/contracts';
import { ID_PREFIX, isId, isSku } from '@getir/core';
import { z } from 'zod';

import {
  MAX_AVAILABILITY_SKUS,
  RESERVATION_TTL_MAX_SECONDS,
  RESERVATION_TTL_MIN_SECONDS,
} from '../../config/constants.js';
import { duplicateSku } from '../../domain/reservation.js';

/** Bos olamayan metin (proto3'te eksik alan "" gelir). */
const requiredText = z.string({ required_error: 'zorunlu' }).trim().min(1, 'zorunlu');

export const checkAvailabilityRequestSchema = z.object({
  marketId: requiredText.pipe(marketIdSchema),
  skus: z.array(requiredText).max(MAX_AVAILABILITY_SKUS, `en fazla ${MAX_AVAILABILITY_SKUS} sku`),
});

/**
 * Reserve (T10.1). Siparis ve kullanici kimligi BICIMIYLE dogrulanir: ikisi de
 * Redis anahtarina girer (resv:{market}:{orderId}, resv:user:{userId}). SKU
 * bicimi de kesin: burada bozuk SKU "bilinmiyor" degil, reddedilen istektir
 * (CheckAvailability'nin esnekligi okuma icindir). Kalem ve adet sinirlari
 * sepetinkiyle ayni (@getir/contracts); tekrar eden SKU reddedilir. Bicim
 * denetimi `pipe` ile: bos alan yalnizca "zorunlu" der, iki mesaj birden degil.
 */
const orderIdSchema = z
  .string()
  .refine((value) => isId(ID_PREFIX.ORDER, value), 'ord_ onekli kimlik bekleniyor');
const userIdSchema = z
  .string()
  .refine((value) => isId(ID_PREFIX.USER, value), 'usr_ onekli kimlik bekleniyor');
const skuSchema = z.string().refine(isSku, 'gecersiz sku');

const reservationItemSchema = z.object({
  sku: requiredText.pipe(skuSchema),
  quantity: z
    .number()
    .int('tam sayi olmali')
    .min(1, 'en az 1')
    .max(CART_ITEM_MAX_QUANTITY, `en fazla ${CART_ITEM_MAX_QUANTITY}`),
});

export const reserveRequestSchema = z.object({
  orderId: requiredText.pipe(orderIdSchema),
  marketId: requiredText.pipe(marketIdSchema),
  userId: requiredText.pipe(userIdSchema),
  items: z
    .array(reservationItemSchema)
    .min(1, 'en az 1 kalem')
    .max(CART_MAX_ITEMS, `en fazla ${CART_MAX_ITEMS} kalem`)
    .superRefine((items, context) => {
      const repeated = duplicateSku(items);
      if (repeated !== undefined) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `ayni sku iki kez: ${repeated}` });
      }
    }),
  ttlSeconds: z
    .number()
    .int('tam sayi olmali')
    .min(RESERVATION_TTL_MIN_SECONDS, `en az ${RESERVATION_TTL_MIN_SECONDS} saniye`)
    .max(RESERVATION_TTL_MAX_SECONDS, `en fazla ${RESERVATION_TTL_MAX_SECONDS} saniye`),
});
