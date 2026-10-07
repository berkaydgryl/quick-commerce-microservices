/**
 * Siparis uclarinin semalari:
 *   POST /v1/orders
 *   POST /v1/orders/{id}/3ds
 *   GET  /v1/orders/{id}
 *   GET  /v1/orders            (T11.16: gecmis siparisler, sayfali ozet)
 *
 * T7.5: govdeler order sozlesmesine (proto) hizalandi. Teslimat adresi artik
 * rezervasyonda gelir (cart.ts); siparis ve 3DS cevabi, servisin dondurdugu
 * kucuk ozettir (orderPlacementSchema), tam siparis GET ile okunur.
 */

import { z } from 'zod';

import {
  cardIdSchema,
  geoPointSchema,
  idSchema,
  isoDateTimeSchema,
  marketIdSchema,
  moneySchema,
  pageSchema,
} from './common.js';
import { deliveryAddressSchema, reservationLineSchema } from './cart.js';
import { orderDetailsSchema, orderDetailsViewSchema } from './checkout-rules.js';
import { ORDER_HISTORY_PAGE_SIZE_MAX, OTP_PATTERN } from './constants.js';
import { orderStatusSchema } from './order-status.js';
import { orderThreeDsSchema } from './order-three-ds.js';

/**
 * Odeme yontemi: kart ya da kapida odeme (T12.4). Kapida odeme yalnizca dusuk
 * risk bandinda aciktir: orta bantta 422 PAYMENT_METHOD_NOT_ALLOWED (order-svc).
 */
export const paymentMethodSchema = z.enum(['CARD', 'CASH_ON_DELIVERY']);

/**
 * Kapida odemenin turu (T12.4): nakit (CASH) ya da kuryenin POS cihazindan
 * kredi/banka karti (POS). Odeme yonteminin CARD'iyla karismasin diye POS.
 * Sipariste saklanir; teslimde tahsilat kaydi henuz yok (T13.3).
 */
export const deliveryPaymentKindSchema = z.enum(['CASH', 'POS']);

/** Kart secilmedi ya da iki kaynak birden geldi: tam biri gerekir. */
export const PAYMENT_CARD_MESSAGE = 'Ödeme için bir kart seç';

/** Kapida odemede tur (nakit ya da POS) secilmedi ya da bilinmiyor. */
export const PAYMENT_ON_DELIVERY_MESSAGE = 'Kapıda nasıl ödeyeceğini seç';

/** Secilen yonteme ait olmayan alan (kapida odemede kart, kartta kapida tur). */
export const PAYMENT_FIELD_NOT_ALLOWED_MESSAGE = 'Bu ödeme yönteminde gönderilmez';

/** Yonteme ait olmayan alan: gonderilirse, GONDERILEN alanda sabit cumle. */
const notAllowed = z.undefined({
  errorMap: () => ({ message: PAYMENT_FIELD_NOT_ALLOWED_MESSAGE }),
});

/**
 * Kartla odeme: kasadaki kart (cardId) ya da (eski) cardToken, TAM biri
 * (asagidaki superRefine).
 */
const cardPaymentInputSchema = z.object({
  method: z.literal('CARD'),
  /**
   * Kayitli kart (T12.4): kart kasasindaki kartin kimligi. Kart verisi ve
   * saglayici jetonu TASINMAZ. Kart yoksa, silinmisse ya da baskasininsa 404
   * NOT_FOUND, ayrintida resource "card" (ikisi ayni cevap): siparis odeme
   * bekler kalir, ayni siparis baska kartla yeniden verilebilir.
   */
  cardId: cardIdSchema.optional(),
  /**
   * DEPRECATED (T12.4): cardId kullanin. Demo saglayicisinin test jetonu;
   * personalar ve eski istemciler icin kabul edilir (kaldirma bekleyen is 118).
   */
  cardToken: z.string().trim().min(1).optional(),
  onDelivery: notAllowed,
});

/** Kapida odeme (T12.4): tur zorunlu; kart alani yok. Cumle degeri yankilamaz. */
const cashOnDeliveryInputSchema = z.object({
  method: z.literal('CASH_ON_DELIVERY'),
  onDelivery: z.enum(deliveryPaymentKindSchema.options, {
    errorMap: () => ({ message: PAYMENT_ON_DELIVERY_MESSAGE }),
  }),
  cardId: notAllowed,
  cardToken: notAllowed,
});

/**
 * Odeme secimi, yonteme gore ayrilir (TS tipi de daralir). Hata ilgili alanda:
 * yonteme ait olmayan alan gonderildigi yerde, kart secimi cardId'de.
 */
export const orderPaymentInputSchema = z
  .discriminatedUnion('method', [cardPaymentInputSchema, cashOnDeliveryInputSchema])
  .superRefine((payment, ctx) => {
    if (
      payment.method === 'CARD' &&
      (payment.cardId === undefined) === (payment.cardToken === undefined)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cardId'],
        message: PAYMENT_CARD_MESSAGE,
      });
    }
  });

/**
 * Cevaptaki odeme secimi (GET /v1/orders/{id}): yontem ve kapida odemenin
 * turu. Kisisel veri degildir. Bu alandan once verilmis sipariste yoktur.
 */
export const orderPaymentViewSchema = z.object({
  method: paymentMethodSchema,
  onDelivery: deliveryPaymentKindSchema.optional(),
});

/**
 * Siparis olusturma istegi.
 *
 * Sepet TEKRAR GONDERILMEZ, yalnizca rezervasyondan donen orderId alinir.
 * Gonderilseydi rezervasyon ile siparis arasinda sepeti degistirip rezerve
 * edilenden baskasini satin almak mumkun olurdu. Adres de burada degil,
 * rezervasyonda verilir: tutar ve risk ona gore hesaplandi.
 */
export const createOrderRequestSchema = z.object({
  orderId: idSchema,
  payment: orderPaymentInputSchema,
  /** Hediye, not, "Zili Çalma", sozlesme onayi (T12.4; kurallar checkout-rules.ts). */
  details: orderDetailsSchema,
});

export const threeDsRequestSchema = z.object({
  challengeId: z.string().min(1),
  /** Tam 6 rakam. Mock saglayicida beklenen kod sabittir. */
  otp: z.string().regex(OTP_PATTERN),
});

/** 3DS bekleyen siparisin dogrulama jetonu (POST /v1/orders/{id}/3ds'e gider). */
export const threeDsChallengeSchema = z.object({
  challengeId: z.string().min(1),
  /**
   * Kodun kalan gecerliligi, sunucu saatiyle saniye (T12.4): pencere cekim
   * anindan baslar (60 sn). Sayac buna gore; istemci saatinden bagimsiz.
   */
  ttlSeconds: z.number().int().min(0).optional(),
});

/**
 * Siparis ve 3DS cevabi (proto CreateOrderResponse / ConfirmPaymentResponse).
 *
 * threeDs YALNIZCA dogrulama bekleniyorsa vardir (durum AWAITING_PAYMENT);
 * yoksa ayri bir bayrak tutulmaz - iki kaynak birbiriyle celisebilirdi.
 */
export const orderPlacementSchema = z.object({
  orderId: idSchema,
  status: orderStatusSchema,
  threeDs: threeDsChallengeSchema.optional(),
});

/** Durum degisikliginin zaman cizelgesindeki kaydi. */
export const orderTimelineEntrySchema = z.object({
  status: orderStatusSchema,
  at: isoDateTimeSchema,
  /** Istege bagli kisa aciklama ANAHTARI (ornek iptal gerekcesi). */
  note: z.string().optional(),
});

export const courierSummarySchema = z.object({
  id: idSchema,
  name: z.string(),
  /** Son bilinen konum; canli akis socket uzerinden gelir. */
  location: geoPointSchema.optional(),
  etaMinutes: z.number().int().min(0).optional(),
});

/**
 * GET /v1/orders/{id} cevabi (proto Order).
 *
 * Tutarlar taslakta DONDURULMUS degerlerdir (T7.2): total = subtotal +
 * deliveryFee - discount.
 */
export const orderSchema = z.object({
  id: idSchema,
  status: orderStatusSchema,
  /** Siparisin verildigi market (ADR-15); kurye buradan alir. */
  marketId: marketIdSchema,
  /** Satirlar fiyati dondurulmus kalemlerdir. */
  lines: z.array(reservationLineSchema),
  subtotal: moneySchema,
  deliveryFee: moneySchema,
  /** Kupon indirimi; POZITIF tutardir ve toplamdan dusulur. */
  discount: moneySchema,
  total: moneySchema,
  address: deliveryAddressSchema,
  /** Siparisin durum gecmisi, eskiden yeniye. */
  timeline: z.array(orderTimelineEntrySchema),
  /** Kurye atandiktan sonra dolar. */
  courier: courierSummarySchema.optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema.optional(),
  /**
   * Stok kilidi canliyken (DRAFT, RESERVED, AWAITING_PAYMENT) bitis ani ve
   * sunucunun saatiyle kalan saniye (T11.4); diger durumlarda yoktur.
   */
  reservationExpiresAt: isoDateTimeSchema.optional(),
  reservationTtlSeconds: z.number().int().min(0).optional(),
  /**
   * Hediye, not, "Zili Çalma" ve sozlesme onayi (T12.4): yalnizca siparisin
   * SAHIBINE doner; ayrintisiz verilmis sipariste yoktur.
   */
  details: orderDetailsViewSchema.optional(),
  /** Odeme yontemi ve kapida odemenin turu (T12.4). */
  payment: orderPaymentViewSchema.optional(),
  /**
   * Bekleyen 3DS dogrulamasinin durumu (#163 B1): yalnizca AWAITING_PAYMENT'ta
   * ve sahibine. Yoklugu "bilinmiyor ya da dogrulama yok" demektir. Anlam,
   * saat yarisi kurali ve ornekler: order-three-ds.ts.
   */
  threeDs: orderThreeDsSchema.optional(),
});

/**
 * Gecmis Siparislerim'in satiri (T11.16; GET /v1/orders): siparisin ozeti.
 * Sepet taslaklari (DRAFT, hic ilerlemeden suresi dolan) listede YOKTUR.
 * Market adi katalogdan gelir; market kaldirilmissa ya da katalog cevap
 * vermediyse yoktur (istemci genel ad yazar).
 */
export const orderSummarySchema = z.object({
  id: idSchema,
  status: orderStatusSchema,
  marketId: marketIdSchema,
  marketName: z.string().min(1).optional(),
  total: moneySchema,
  /**
   * Ucreti alinmis siparisin iptali (gecmiste PAID, durum CANCELLED): odeme
   * iade edildi. Degilse yoktur.
   */
  refunded: z.literal(true).optional(),
  createdAt: isoDateTimeSchema,
});

/**
 * GET /v1/orders cevabi: yeniden eskiye, imlecle sayfali. Suzme yuzunden
 * toplam sayilmaz (page.totalSize 0). Sayfa ORDER_HISTORY_PAGE_SIZE_MAX'i asmaz.
 */
export const orderSummaryListSchema = z.object({
  items: z.array(orderSummarySchema).max(ORDER_HISTORY_PAGE_SIZE_MAX),
  page: pageSchema,
});

export type PaymentMethod = z.infer<typeof paymentMethodSchema>;
export type DeliveryPaymentKind = z.infer<typeof deliveryPaymentKindSchema>;
export type OrderPaymentView = z.infer<typeof orderPaymentViewSchema>;
export type OrderPaymentInput = z.infer<typeof orderPaymentInputSchema>;
export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;
export type ThreeDsRequest = z.infer<typeof threeDsRequestSchema>;
export type ThreeDsChallenge = z.infer<typeof threeDsChallengeSchema>;
export type OrderPlacement = z.infer<typeof orderPlacementSchema>;
export type OrderTimelineEntry = z.infer<typeof orderTimelineEntrySchema>;
export type CourierSummary = z.infer<typeof courierSummarySchema>;
export type Order = z.infer<typeof orderSchema>;
export type OrderSummary = z.infer<typeof orderSummarySchema>;
export type OrderSummaryList = z.infer<typeof orderSummaryListSchema>;
