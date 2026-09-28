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
import { paymentV1 } from '@getir/proto';
import { z } from 'zod';

import { PAYMENT_METHOD } from '../../domain/checkout-payment.js';
import type { PaymentMethod } from '../../domain/checkout-payment.js';
import type { CheckoutSignals } from '../../domain/checkout-risk.js';
import type { OrderHistoryCursor } from '../../domain/order-history-cursor.js';

import { MAX_CANCEL_REASON_LENGTH, MAX_SIGNAL_TEXT_LENGTH } from '../../config/constants.js';
import { decodePageToken } from './page-token.js';

const requiredText = (field: string) => z.string().trim().min(1, `${field} zorunlu`);

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
const idempotencyKey = idempotencyKeySchema;

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
 * Proto yontemi -> order'in sozlugu. Record TUM enum degerlerini ister: proto'ya
 * yontem eklenirse burasi DERLEMEDE kirilir. UNSPECIFIED/UNRECOGNIZED gecersiz.
 */
const METHOD_FROM_PROTO: Readonly<Record<paymentV1.PaymentMethod, PaymentMethod | undefined>> = {
  [paymentV1.PaymentMethod.PAYMENT_METHOD_UNSPECIFIED]: undefined,
  [paymentV1.PaymentMethod.PAYMENT_METHOD_CARD]: PAYMENT_METHOD.CARD,
  [paymentV1.PaymentMethod.PAYMENT_METHOD_CASH_ON_DELIVERY]: PAYMENT_METHOD.CASH_ON_DELIVERY,
  [paymentV1.PaymentMethod.UNRECOGNIZED]: undefined,
};

const paymentMethod = z.nativeEnum(paymentV1.PaymentMethod).transform((value, ctx) => {
  const mapped = METHOD_FROM_PROTO[value];
  if (mapped === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'odeme yontemi zorunlu' });
    return z.NEVER;
  }
  return mapped;
});

/**
 * Gateway'in doldurdugu risk sinyalleri (T7.5, proto CheckoutSignals).
 *
 * Yalnizca uzunluk ve bicim dogrulanir; deger YORUMLANMAZ, risk-svc'ye tasinir.
 * proto3'te gonderilmeyen metin "", sayi 0 gelir: ikisi de "yok" demektir (risk
 * sozlesmesi) ve alan hic tasinmaz. Mesaj hic gelmezse sinyal yoktur.
 */
const signalText = z
  .string()
  .trim()
  .max(MAX_SIGNAL_TEXT_LENGTH, `en fazla ${MAX_SIGNAL_TEXT_LENGTH} karakter olmali`)
  .transform((value) => (value === '' ? undefined : value));

const checkoutSignals = z
  .object({
    ipAddress: signalText,
    ipCity: signalText,
    deviceId: signalText,
    accountsOnDevice: z
      .number()
      .int()
      .min(0)
      .transform((count) => (count === 0 ? undefined : count)),
    previousIpAddress: signalText,
    sessionLocation: geoPointSchema.optional(),
    accountCreatedAt: z.date().optional(),
  })
  .optional()
  .transform((signals): CheckoutSignals => signals ?? {});

/**
 * CreateOrder (T7.1): odeme yontemi ve kart jetonu artik okunur. Kartli odemede
 * jeton zorunlu; kapida odemede dolu jeton sessizce yok sayilmaz (istemci
 * yontemi yanlis secmis olabilir) - payment-svc'deki kuralla ayni.
 * Kapida odemenin RISK bandina gore kapali olmasi is kuralidir, use-case'tedir.
 */
export const createOrderRequestSchema = z
  .object({
    orderId: requiredText('orderId'),
    userId: requiredText('userId'),
    paymentMethod,
    cardToken: z.string().trim(),
    idempotencyKey,
    signals: checkoutSignals,
  })
  .superRefine((input, ctx) => {
    // Yontem gecersizse jeton kurali ikinci bir hata uretmesin: istemci once yontemi duzeltir.
    const knownMethods: readonly unknown[] = Object.values(PAYMENT_METHOD);
    if (!knownMethods.includes(input.paymentMethod)) {
      return;
    }
    const isCard = input.paymentMethod === PAYMENT_METHOD.CARD;
    if (isCard && input.cardToken === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cardToken'],
        message: 'kartli odemede zorunlu',
      });
    }
    if (!isCard && input.cardToken !== '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cardToken'],
        message: 'kapida odemede bos olmali',
      });
    }
  })
  .transform(({ cardToken, ...rest }) => ({
    ...rest,
    ...(cardToken === '' ? {} : { cardToken }),
  }));

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
