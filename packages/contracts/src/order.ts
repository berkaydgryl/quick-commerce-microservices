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
  geoPointSchema,
  idSchema,
  isoDateTimeSchema,
  marketIdSchema,
  moneySchema,
  pageSchema,
} from './common.js';
import { deliveryAddressSchema, reservationLineSchema } from './cart.js';
import { ORDER_HISTORY_PAGE_SIZE_MAX, OTP_PATTERN } from './constants.js';
import { orderStatusSchema } from './order-status.js';

/**
 * Odeme yontemi.
 *
 * Bu fazda yalnizca KART acilmistir. Kapida odeme risk bandi kurallarinda
 * geciyor olsa da REST yuzeyinde henuz bir secenek olarak sunulmuyor; yeni bir
 * deger eklemek once openapi.yaml'in guncellenmesini gerektirir.
 */
export const paymentMethodSchema = z.enum(['CARD']);

export const orderPaymentInputSchema = z.object({
  method: paymentMethodSchema,
  /**
   * Demo saglayicisinin urettigi jeton; kart numarasi TASINMAZ. Kartli odemede
   * ZORUNLU (tek yontem kart oldugu icin her zaman).
   */
  cardToken: z.string().trim().min(1),
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
});

export const threeDsRequestSchema = z.object({
  challengeId: z.string().min(1),
  /** Tam 6 rakam. Mock saglayicida beklenen kod sabittir. */
  otp: z.string().regex(OTP_PATTERN),
});

/** 3DS bekleyen siparisin dogrulama jetonu (POST /v1/orders/{id}/3ds'e gider). */
export const threeDsChallengeSchema = z.object({
  challengeId: z.string().min(1),
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
