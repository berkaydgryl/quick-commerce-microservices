/**
 * Servisler arasi olay GOVDELERI: stream:events'teki zarfin `payload` alani.
 *
 * Zarfin kendisi @getir/event-bus'tadir ve sabittir (ADR-07); burasi yalnizca
 * olaya ozel govdeyi tanimlar. Ureten servis govdeyi bu tipten kurar, tuketen
 * servis bu semadan gecirir: iki taraf ayni tanimi gordugu icin ayrisma
 * derlemede ya da sozlesme testinde yakalanir. Degisiklik kurali "alan ekle,
 * alan silme"dir (ADR-07, sema kayit defteri yok).
 *
 * Yalnizca DINLENEN olaylarin govdesi burada durur. order.created ve
 * order.status_changed'i bugun kimse dinlemiyor; tuketicisi gelince (T12.3,
 * realtime) semasi buraya eklenir.
 */

import { z } from 'zod';

import { idempotencyKeySchema, idSchema } from './common.js';
import { REFUND_REASON_MAX_LENGTH, REFUND_REASON_PATTERN } from './constants.js';

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
