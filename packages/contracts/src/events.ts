/**
 * Servisler arasi olay GOVDELERI: stream:events'teki zarfin `payload` alani.
 *
 * Zarfin kendisi @getir/event-bus'tadir ve sabittir (ADR-07); burasi yalnizca
 * olaya ozel govdeyi tanimlar. Ureten servis govdeyi bu tipten kurar, tuketen
 * servis bu semadan gecirir: iki taraf ayni tanimi gordugu icin ayrisma
 * derlemede ya da sozlesme testinde yakalanir. Degisiklik kurali "alan ekle,
 * alan silme"dir (ADR-07, sema kayit defteri yok).
 *
 * Yalnizca DINLENEN olaylarin govdesi burada durur. order.status_changed'i
 * T12.3'ten beri realtime dinliyor; order.created'i bugun kimse dinlemiyor,
 * tuketicisi gelince semasi buraya eklenir. Kurye olaylari (T13.3) courier'dan
 * order'a ve (asama 2) realtime'a gider.
 */

import { z } from 'zod';

import {
  courierIdSchema,
  idempotencyKeySchema,
  idSchema,
  marketIdSchema,
  orderIdSchema,
} from './common.js';
import { REFUND_REASON_MAX_LENGTH, REFUND_REASON_PATTERN } from './constants.js';
import { orderStatusSchema } from './order-status.js';

/** Iade gerekcesi anahtari: Refund RPC'si ve iade komutu ayni kurali kullanir. */
export const refundReasonSchema = z
  .string()
  .trim()
  .min(1, 'reason zorunlu')
  .max(REFUND_REASON_MAX_LENGTH, `en fazla ${REFUND_REASON_MAX_LENGTH} karakter olmali`)
  .regex(
    REFUND_REASON_PATTERN,
    'gerekce kucuk harf, rakam ve alt cizgiden olusan bir anahtar olmali',
  );

/**
 * payment.refund_requested (T7.3 uretir, T7.4 dinler): siparis saga'sinin
 * kalici telafi komutu. Tutar alindi ama siparis PAID yazilamadi ve dogrudan
 * iade de basarisiz oldu. Iade siparis kimligiyle bulunur (siparisin tek
 * odemesi var); anahtar siparisten turer (refund-<orderId>).
 */
export const refundRequestedPayloadSchema = z.object({
  orderId: idSchema,
  reason: refundReasonSchema,
  idempotencyKey: idempotencyKeySchema,
});

export type RefundRequestedPayload = z.infer<typeof refundRequestedPayloadSchema>;

/**
 * payment.cancel_requested (T11.2 PR 3; order uretir, payment dinler): siparis
 * odeme asamasindan CANCELLED'a gecti. Odeme siparis kimligiyle bulunur.
 * Gerekce anahtari iadeyle ayni kurala uyar (kayda oldugu gibi yazilir).
 * Anahtar yok: islem durumdan tekrar-guvenlidir (zaten CANCELLED ise yazilmaz).
 */
export const paymentCancelRequestedPayloadSchema = z.object({
  orderId: idSchema,
  reason: refundReasonSchema,
});

export type PaymentCancelRequestedPayload = z.infer<typeof paymentCancelRequestedPayloadSchema>;

/**
 * order.status_changed (T7.3 uretir, T12.3 realtime dinler): siparisin bir
 * durum gecisi. Tek yazimda birden cok gecis olabilir (risk adimi); her biri
 * ayri olaydir ve `version`'lari ardisiktir. Zarfin `occurredAt`'i gecisin
 * zaman cizelgesindeki anidir.
 *
 * `userId` ve `note` IC alanlardir: realtime sokete yalnizca orderId, durum,
 * onceki durum, an ve `version`'dan turettigi `seq`'i cikarir
 * (socket.ts orderStatusEventSchema).
 */
export const orderStatusChangedPayloadSchema = z.object({
  orderId: orderIdSchema,
  userId: idSchema,
  marketId: marketIdSchema,
  /** Ilk gecisin oncesi yoktur (zaman cizelgesinin ilk kaydi). */
  from: orderStatusSchema.optional(),
  to: orderStatusSchema,
  /** Gecisin gerekce anahtari (or. CART_RELEASED); yalnizca ic kullanim. */
  note: z.string().optional(),
  /** Gecisin siparise getirdigi surum; soket olayinin seq'i olur. */
  version: z.number().int().positive(),
});

export type OrderStatusChangedPayload = z.infer<typeof orderStatusChangedPayloadSchema>;

/**
 * courier.picked_up (T13.3 courier uretir, T14.3 order dinler): kurye markette
 * ve hazirlik suresi doldu, paket alindi. Zarfin occurredAt'i alinma anidir.
 *
 * Teslim EN AZ BIR KEZ: courier yayinlandi isaretini koyana kadar her tick
 * yeniden yayinlar; ayni olay tekrar gelebilir. Siralama garantisi YOK:
 * courier.delivered bundan once islenebilir.
 *
 * TUKETICI KURALI (order):
 *   - `courierId` siparisin SU ANKI kuryesi degilse olay eskidir (kurye
 *     birakilip yeniden atandi): yok sayilir.
 *   - Siparis PREPARING ise -> ON_THE_WAY. Zaten ON_THE_WAY ya da DELIVERED
 *     ise tekrar: yok sayilir.
 *   - Siparis henuz PAID ise (atamanin PREPARING yazimi gecikti) olay
 *     ONAYLANMAZ, yeniden teslim icin hata doner: yok sayilsaydi bir daha
 *     gelmezdi ve siparis PREPARING'de kalirdi.
 *   - Son durumlar (CANCELLED, REJECTED...) yok sayilir.
 */
export const courierPickedUpPayloadSchema = z.object({
  orderId: orderIdSchema,
  courierId: courierIdSchema,
  marketId: marketIdSchema,
});

/**
 * courier.delivered (T13.3 courier uretir, T14.3 order dinler): rota bitti,
 * paket teslim edildi; kurye o anda bosa cikar (IDLE). Zarfin occurredAt'i
 * teslim anidir. Teslim ve sira kurali courier.picked_up ile ayni.
 *
 * TUKETICI KURALI (order): kurye eslesmesi ve PAID/son durum kurali
 * courier.picked_up ile ayni. ON_THE_WAY -> DELIVERED; siparis hala PREPARING
 * ise (picked_up gecikti) iki gecis ardisik yapilir.
 */
export const courierDeliveredPayloadSchema = z.object({
  orderId: orderIdSchema,
  courierId: courierIdSchema,
});

export type CourierPickedUpPayload = z.infer<typeof courierPickedUpPayloadSchema>;
export type CourierDeliveredPayload = z.infer<typeof courierDeliveredPayloadSchema>;
