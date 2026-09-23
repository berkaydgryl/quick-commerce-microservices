/**
 * gRPC istek semalari (Zod).
 *
 * Proto bicimi dogrular, KURALI dogrulamaz: "sepet bos olamaz", "adet pozitif
 * olmali", "idempotency anahtari zorunlu" gibi kurallar sozlesmede yaziyla
 * anlatilmis; burada calisir hale geliyor (ADR-10).
 */

import { isSku } from '@getir/core';
import { z } from 'zod';

import {
  MAX_CANCEL_REASON_LENGTH,
  MAX_CART_LINES,
  MAX_LINE_QUANTITY,
  MIN_IDEMPOTENCY_KEY_LENGTH,
} from '../../config/constants.js';

const requiredText = (field: string) => z.string().trim().min(1, `${field} zorunlu`);

/**
 * Idempotency anahtari (ADR-08): tum mutasyon uclari ister.
 *
 * BUGUN YALNIZCA VARLIGI dogrulaniyor; ayni anahtarla gelen ikinci istegin
 * ilkinin cevabini dondurmesi (tekrar korumasi) idem:{key} kaydi ile gateway
 * tarafinda kurulacak. Anahtari simdiden ZORUNLU tutmak onemli: istemciler
 * gondermeye bugun alissin, koruma acildiginda sozlesme degismesin.
 */
const idempotencyKey = z
  .string()
  .trim()
  .min(MIN_IDEMPOTENCY_KEY_LENGTH, `en az ${MIN_IDEMPOTENCY_KEY_LENGTH} karakter olmali`);

const cartLine = z.object({
  productId: requiredText('productId'),
  sku: requiredText('sku').refine(isSku, 'gecersiz sku bicimi'),
  quantity: z.number().int().positive().max(MAX_LINE_QUANTITY),
});

const geoPoint = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const createDraftOrderRequestSchema = z.object({
  userId: requiredText('userId'),
  darkStoreId: requiredText('darkStoreId'),
  lines: z.array(cartLine).min(1, 'sepet bos olamaz').max(MAX_CART_LINES),
  // Konum ZORUNLU: teslimat noktasi olmadan hangi depodan cikilacagi ve
  // kurye rotasi hesaplanamaz. proto3'te ic ice mesaj gonderilmezse undefined
  // gelir; sema bunu acikca reddeder.
  deliveryLocation: geoPoint,
  deliveryAddress: requiredText('deliveryAddress'),
  idempotencyKey,
});

export const createOrderRequestSchema = z.object({
  orderId: requiredText('orderId'),
  userId: requiredText('userId'),
  idempotencyKey,
  // paymentMethod ve cardToken BUGUN OKUNMUYOR: odeme cekimi T7.1'de gelecek.
  // Semaya simdiden koymak, dogrulanip hicbir yerde kullanilmayan bir alan
  // uretirdi; sozlesmede duruyor olmasi yeterli.
});

/**
 * Iptal gerekcesi ANAHTARI (metin degil): zaman cizelgesine ve outbox
 * olayina yazilir, istemci kullanici diline cevirir. Bos = gerekce yok.
 */
const cancelReason = z
  .string()
  .trim()
  .max(MAX_CANCEL_REASON_LENGTH)
  .regex(/^[A-Z0-9_]*$/, 'gerekce buyuk harf, rakam ve alt cizgiden olusan bir anahtar olmali')
  .transform((value) => (value === '' ? undefined : value));

export const cancelOrderRequestSchema = z.object({
  orderId: requiredText('orderId'),
  userId: requiredText('userId'),
  reason: cancelReason,
});

export type CreateDraftOrderInput = z.infer<typeof createDraftOrderRequestSchema>;
export type CreateOrderRequestInput = z.infer<typeof createOrderRequestSchema>;
