/**
 * Siparis uclarinin semalari:
 *   POST /v1/orders
 *   POST /v1/orders/{id}/3ds
 *   GET  /v1/orders/{id}
 */

import { ORDER_STATUS } from '@getir/core';
import { z } from 'zod';

import {
  geoPointSchema,
  idSchema,
  isoDateTimeSchema,
  marketIdSchema,
  moneySchema,
} from './common.js';
import { reservationLineSchema } from './cart.js';
import { ADDRESS_LINE_MAX_LENGTH, ADDRESS_NOTE_MAX_LENGTH, OTP_PATTERN } from './constants.js';

/**
 * Siparis durumu.
 *
 * TEK KAYNAK @getir/core icindeki ORDER_STATUS'tur; liste burada tekrar
 * YAZILMAZ. Durum makinesine yeni bir dugum eklendiginde bu sema kendiliginden
 * genisler.
 */
export const orderStatusSchema = z.nativeEnum(ORDER_STATUS);

export const deliveryAddressSchema = z.object({
  title: z.string(),
  line: z.string().max(ADDRESS_LINE_MAX_LENGTH),
  /** Konum gercegi buradadir; line yalnizca gosterim icindir. */
  location: geoPointSchema,
  note: z.string().max(ADDRESS_NOTE_MAX_LENGTH).optional(),
});

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
  /** Demo saglayicisinin urettigi jeton; kart numarasi TASINMAZ. */
  cardToken: z.string().optional(),
});

/**
 * Siparis olusturma istegi.
 *
 * Sepet TEKRAR GONDERILMEZ, yalnizca rezervasyondan donen orderId alinir.
 * Gonderilseydi rezervasyon ile siparis arasinda sepeti degistirip rezerve
 * edilenden baskasini satin almak mumkun olurdu.
 */
export const createOrderRequestSchema = z.object({
  orderId: idSchema,
  address: deliveryAddressSchema,
  payment: orderPaymentInputSchema,
});

export const threeDsRequestSchema = z.object({
  challengeId: z.string(),
  /** Tam 6 rakam. Mock saglayicida beklenen kod sabittir. */
  otp: z.string().regex(OTP_PATTERN),
});

/** Siparis AWAITING_PAYMENT durumundayken doldurulur. */
export const threeDsChallengeSchema = z.object({
  challengeId: z.string(),
  expiresAt: isoDateTimeSchema,
});

export const courierSummarySchema = z.object({
  id: idSchema,
  name: z.string(),
  /** Son bilinen konum; canli akis socket uzerinden gelir. */
  location: geoPointSchema.optional(),
  etaMinutes: z.number().int().min(0).optional(),
});

export const orderSchema = z.object({
  id: idSchema,
  status: orderStatusSchema,
  /** Siparisin verildigi market (ADR-15); kurye buradan alir. */
  marketId: marketIdSchema,
  /** Satirlar rezervasyondaki ile ayni sekildedir; fiyat dondurulmustur. */
  lines: z.array(reservationLineSchema),
  subtotal: moneySchema.optional(),
  deliveryFee: moneySchema.optional(),
  total: moneySchema,
  address: deliveryAddressSchema.optional(),
  /** Yalnizca 3DS bekleyen siparislerde dolu olur. */
  threeDs: threeDsChallengeSchema.optional(),
  /** Kurye atandiktan sonra dolar. */
  courier: courierSummarySchema.optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema.optional(),
});

export type OrderStatus = z.infer<typeof orderStatusSchema>;
export type DeliveryAddress = z.infer<typeof deliveryAddressSchema>;
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;
export type OrderPaymentInput = z.infer<typeof orderPaymentInputSchema>;
export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;
export type ThreeDsRequest = z.infer<typeof threeDsRequestSchema>;
export type ThreeDsChallenge = z.infer<typeof threeDsChallengeSchema>;
export type CourierSummary = z.infer<typeof courierSummarySchema>;
export type Order = z.infer<typeof orderSchema>;
