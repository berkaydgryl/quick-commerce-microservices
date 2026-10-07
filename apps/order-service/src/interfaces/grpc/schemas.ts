/**
 * gRPC istek semalari (Zod).
 *
 * Proto bicimi dogrular, KURALI dogrulamaz: "sepet bos olamaz", "adet pozitif
 * olmali", "idempotency anahtari zorunlu" gibi kurallar sozlesmede yaziyla
 * anlatilmis; burada calisir hale geliyor (ADR-10).
 */

import {
  ADDRESS_LINE_MAX_LENGTH,
  CART_ITEM_MAX_QUANTITY,
  CART_MAX_ITEMS,
  COUPON_CODE_MAX_LENGTH,
  geoPointSchema,
  idempotencyKeySchema,
  marketIdSchema,
  moneySchema,
  OTP_PATTERN,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
} from '@getir/contracts';
import { CURRENCY, isSku } from '@getir/core';
import { z } from 'zod';

import type { OrderHistoryCursor } from '../../domain/order-history-cursor.js';
import { SYSTEM_CANCELLATION_NOTES } from '../../domain/stock-reservation.js';

import { MAX_CANCEL_REASON_LENGTH } from '../../config/constants.js';
import { decodePageToken } from './page-token.js';

export const requiredText = (field: string) => z.string().trim().min(1, `${field} zorunlu`);

/**
 * Idempotency anahtari (ADR-08): tum mutasyon uclari ister.
 *
 * BUGUN VARLIGI ve UZUNLUGU dogrulaniyor; ayni anahtarla gelen ikinci istegin
 * ilkinin cevabini dondurmesi (tekrar korumasi) idem:{key} kaydi ile gateway
 * tarafinda kurulacak. Anahtari simdiden ZORUNLU tutmak onemli: istemciler
 * gondermeye bugun alissin, koruma acildiginda sozlesme degismesin. Kural
 * contracts'taki TEK semadir (D5): REST basligi, payment ve order ayni sinirlari
 * uygular - REST'in kabul ettigi anahtari order reddetmemeli.
 */
export const idempotencyKey = idempotencyKeySchema;

/**
 * sku ISTEGE BAGLI (T7.5): REST sepeti sku tasimaz, order onu catalog
 * teklifinden alir. proto3'te gonderilmeyen metin "" gelir = verilmedi.
 * Verildiyse bicimi dogru olmali; teklifle eslesmesi price-draft'ta sorulur.
 */
const optionalSku = z
  .string()
  .trim()
  .refine((sku) => sku === '' || isSku(sku), 'gecersiz sku bicimi')
  .transform((sku) => (sku === '' ? undefined : sku));

// Mesajlar Turkce (T7.5): REST cevabinin details'inde kullaniciya gorunur.
const cartLine = z.object({
  productId: requiredText('productId'),
  sku: optionalSku,
  quantity: z
    .number()
    .int('tam sayi olmali')
    .positive('en az 1 olmali')
    .max(CART_ITEM_MAX_QUANTITY, `en fazla ${CART_ITEM_MAX_QUANTITY} olmali`),
});

/** Ayni urun iki satirda gelirse hangisinin adedi gecerli belirsizdir: reddedilir. */
const cartLines = z
  .array(cartLine)
  .min(1, 'sepet bos olamaz')
  .max(CART_MAX_ITEMS, `en fazla ${CART_MAX_ITEMS} kalem olmali`)
  .refine(
    (lines) => new Set(lines.map((line) => line.productId)).size === lines.length,
    'ayni urun birden fazla satirda olamaz',
  );

/**
 * proto Money, ZORUNLU. Tutar sozlesmedeki kuralla (kurus, tam sayi, >= 0).
 * proto sozlesmesi: bos para birimi TRY sayilir; dolu gelirse sozlesmedeki
 * tek birimle ayni olmali. Mesaj gonderilmezse proto3'te undefined gelir.
 */
const requiredMoney = z.object(
  {
    amountMinor: moneySchema.shape.amountMinor,
    currency: z
      .string()
      .transform((currency) => (currency === '' ? CURRENCY : currency))
      .pipe(moneySchema.shape.currency),
  },
  { required_error: 'zorunlu' },
);

/** Kupon kodu: bos = kupon yok. Buyuk/kucuk harf ve bosluk pricing'de normallesir. */
const couponCode = z
  .string()
  .trim()
  .max(COUPON_CODE_MAX_LENGTH, `en fazla ${COUPON_CODE_MAX_LENGTH} karakter olmali`)
  .transform((value) => (value === '' ? undefined : value));

export const createDraftOrderRequestSchema = z.object({
  userId: requiredText('userId'),
  // ADR-15: siparis kullanicinin SECTIGI markete verilir. Bicim kurali
  // (mkt_ + okunabilir govde) sozlesme paketindedir, burada tekrar yazilmaz.
  // Kullanimdan kalkan dark_store_id OKUNMAZ: gateway (T7.5) onu doldurmaz ve
  // eski "ds_" kimligi bir market degildir.
  marketId: marketIdSchema,
  lines: cartLines,
  // Konum ZORUNLU: teslimat noktasi olmadan hangi depodan cikilacagi ve
  // kurye rotasi hesaplanamaz. proto3'te ic ice mesaj gonderilmezse undefined
  // gelir; sema bunu acikca reddeder. WGS84 sinirlari sozlesme paketindedir.
  deliveryLocation: geoPointSchema,
  // Uzunluk siniri REST sozlesmesiyle ayni (contracts ADDRESS_LINE_MAX_LENGTH); T7.5
  // canli testinde sinirsiz metnin gectigi goruldu.
  deliveryAddress: requiredText('deliveryAddress').pipe(
    z.string().max(ADDRESS_LINE_MAX_LENGTH, `en fazla ${ADDRESS_LINE_MAX_LENGTH} karakter olmali`),
  ),
  idempotencyKey,
  // T7.2: istemcinin gordugu toplam ZORUNLU; sunucu kendi hesabiyla karsilastirir.
  expectedTotal: requiredMoney,
  couponCode,
});

/**
 * ConfirmPayment (T7.1). Kod bicimi sozlesmedeki OTP kuraliyla ayni (6 hane);
 * bicimi bozuk kod payment-svc'ye hic gitmez, hak yanmaz.
 */
export const confirmPaymentRequestSchema = z.object({
  orderId: requiredText('orderId'),
  userId: requiredText('userId'),
  challengeId: requiredText('challengeId'),
  code: z.string().trim().regex(OTP_PATTERN, '6 haneli kod olmali'),
  idempotencyKey,
});

/**
 * Iptal gerekcesi ANAHTARI (metin degil): zaman cizelgesine ve outbox
 * olayina yazilir, istemci kullanici diline cevirir. Bos = gerekce yok.
 *
 * Sistemin iptal notlari (stok yetmedi, sure doldu, sepet yenilendi) kullaniciya
 * KAPALI: risk gecmisi o notla iptali saymaz (T11.2); kullanici kendi iptalini
 * boyle gizleyemez.
 */
const cancelReason = z
  .string()
  .trim()
  .max(MAX_CANCEL_REASON_LENGTH)
  .regex(/^[A-Z0-9_]*$/, 'gerekce buyuk harf, rakam ve alt cizgiden olusan bir anahtar olmali')
  .refine((value) => !SYSTEM_CANCELLATION_NOTES.includes(value), 'bu gerekce sisteme ayrilmis')
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
