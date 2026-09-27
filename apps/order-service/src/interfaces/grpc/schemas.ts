/**
 * gRPC istek semalari (Zod).
 *
 * Proto bicimi dogrular, KURALI dogrulamaz: "sepet bos olamaz", "adet pozitif
 * olmali", "idempotency anahtari zorunlu" gibi kurallar sozlesmede yaziyla
 * anlatilmis; burada calisir hale geliyor (ADR-10).
 */

import {
  CART_ITEM_MAX_QUANTITY,
  CART_MAX_ITEMS,
  geoPointSchema,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
  marketIdSchema,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
} from '@getir/contracts';
import { isSku } from '@getir/core';
import { z } from 'zod';

import type { OrderHistoryCursor } from '../../domain/order-history-cursor.js';

import { MAX_CANCEL_REASON_LENGTH } from '../../config/constants.js';
import { decodePageToken } from './page-token.js';

const requiredText = (field: string) => z.string().trim().min(1, `${field} zorunlu`);

/**
 * Idempotency anahtari (ADR-08): tum mutasyon uclari ister.
 *
 * BUGUN VARLIGI ve UZUNLUGU dogrulaniyor; ayni anahtarla gelen ikinci istegin
 * ilkinin cevabini dondurmesi (tekrar korumasi) idem:{key} kaydi ile gateway
 * tarafinda kurulacak. Anahtari simdiden ZORUNLU tutmak onemli: istemciler
 * gondermeye bugun alissin, koruma acildiginda sozlesme degismesin. Sinirlar
 * REST basligi ve Redis anahtariyla ayni kaynaktan gelir: REST'in kabul ettigi
 * anahtari order reddetmemeli, reddettigini de kabul etmemeli.
 */
const idempotencyKey = z
  .string()
  .trim()
  .min(IDEMPOTENCY_KEY_MIN_LENGTH, `en az ${IDEMPOTENCY_KEY_MIN_LENGTH} karakter olmali`)
  .max(IDEMPOTENCY_KEY_MAX_LENGTH, `en fazla ${IDEMPOTENCY_KEY_MAX_LENGTH} karakter olmali`);

const cartLine = z.object({
  productId: requiredText('productId'),
  sku: requiredText('sku').refine(isSku, 'gecersiz sku bicimi'),
  quantity: z.number().int().positive().max(CART_ITEM_MAX_QUANTITY),
});

export const createDraftOrderRequestSchema = z.object({
  userId: requiredText('userId'),
  // ADR-15: siparis kullanicinin SECTIGI markete verilir. Bicim kurali
  // (mkt_ + okunabilir govde) sozlesme paketindedir, burada tekrar yazilmaz.
  // Kullanimdan kalkan dark_store_id OKUNMAZ: onu dolduran istemci yok
  // (gateway henuz order'a baglanmadi) ve eski "ds_" kimligi bir market degildir.
  marketId: marketIdSchema,
  lines: z.array(cartLine).min(1, 'sepet bos olamaz').max(CART_MAX_ITEMS),
  // Konum ZORUNLU: teslimat noktasi olmadan hangi depodan cikilacagi ve
  // kurye rotasi hesaplanamaz. proto3'te ic ice mesaj gonderilmezse undefined
  // gelir; sema bunu acikca reddeder. WGS84 sinirlari sozlesme paketindedir.
  deliveryLocation: geoPointSchema,
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
  // Iptal de bir mutasyondur (ADR-08): anahtar zorunlu. Use-case onu okumaz;
  // tekrar korumasi gateway'dedir, burada yalnizca varligi ve bicimi dogrulanir.
  idempotencyKey,
});

export const getOrderRequestSchema = z.object({
  orderId: requiredText('orderId'),
  userId: requiredText('userId'),
});

/**
 * Sayfa boyutu (getir.common.v1.PageRequest): 0 veya negatif -> varsayilan,
 * ust sinirdan buyuk -> REDDEDILMEZ, kirpilir. Sinirlar REST ile ayni kaynaktan
 * (@getir/contracts) gelir; iki kapida iki farkli sinir olmasin.
 */
const pageSize = z
  .number()
  .int()
  .transform((value) => (value <= 0 ? PAGE_SIZE_DEFAULT : Math.min(value, PAGE_SIZE_MAX)));

/** Opak sayfa jetonu -> imlec. Bos = ilk sayfa; cozulemeyen jeton INVALID_ARGUMENT. */
const pageToken = z.string().transform((token, context): OrderHistoryCursor | undefined => {
  if (token === '') {
    return undefined;
  }
  const cursor = decodePageToken(token);
  if (cursor === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'gecersiz sayfa jetonu' });
    return z.NEVER;
  }
  return cursor;
});

/** proto3'te `page` gonderilmezse tanimsiz gelir: ilk sayfa, varsayilan boyut. */
const pageRequest = z
  .object({ pageSize, pageToken })
  .default({ pageSize: PAGE_SIZE_DEFAULT, pageToken: '' });

export const listMyOrdersRequestSchema = z.object({
  userId: requiredText('userId'),
  page: pageRequest,
});

export type CreateDraftOrderInput = z.infer<typeof createDraftOrderRequestSchema>;
export type CreateOrderRequestInput = z.infer<typeof createOrderRequestSchema>;
