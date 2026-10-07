/**
 * Siparis ayrintilarinin kurallari (T12.4; B2): hediye, not, "Zili Çalma",
 * sozlesme onayi. TEK kaynak: web formu (features/checkout), gateway (REST
 * dogrulamasi) ve order-svc ayni sinirlari ve cumleleri buradan kullanir.
 *
 * Uzunluk UTF-16 kod birimidir (JavaScript `length`, zod `max`); Go tarafi
 * ayni birimi sayar. Metinler kirpilarak (trim) olculur. Cumleler degeri
 * YANKILAMAZ: kisisel veri hata ayrintisina girmez.
 *
 * Kisisel veri (alici adi ve telefonu, gonderici adi) gunluge, ize ve olaylara
 * yazilmaz; hediye mesaji ve not gunlukte maskelenir (order-svc, gateway).
 */

import { z } from 'zod';

import { PHONE_MESSAGE } from './auth.js';
import { isoDateTimeSchema } from './common.js';
import { PHONE_PATTERN } from './constants.js';

/** Hediye mesaji ve siparis notu en fazla bu kadar karakter. */
export const CHECKOUT_TEXT_MAX = 250;
/** Gonderici ve alici adi en fazla bu kadar karakter. */
export const GIFT_NAME_MAX = 60;

export const RECIPIENT_NAME_MESSAGE = 'Alıcının adını yaz';
export const GIFT_NAME_LENGTH_MESSAGE = `Ad en fazla ${GIFT_NAME_MAX} karakter olabilir`;
export const GIFT_MESSAGE_LENGTH_MESSAGE = `Hediye notu en fazla ${CHECKOUT_TEXT_MAX} karakter olabilir`;
export const NOTE_LENGTH_MESSAGE = `Not en fazla ${CHECKOUT_TEXT_MAX} karakter olabilir`;
export const AGREEMENTS_MESSAGE = 'Siparişi vermek için sözleşmeleri onayla';

/**
 * Hediye: yalnizca hediye acikken gonderilir (enabled her zaman true); kapaliysa
 * alan yoktur. Alici adi bosluktan ibaret olamaz; telefon E.164 cep numarasi
 * (giris ve kayitla ayni kural). Mesaj ve gonderici adi bos olabilir.
 */
export const giftDetailsSchema = z.object({
  enabled: z.literal(true),
  message: z.string().trim().max(CHECKOUT_TEXT_MAX, GIFT_MESSAGE_LENGTH_MESSAGE),
  senderName: z.string().trim().max(GIFT_NAME_MAX, GIFT_NAME_LENGTH_MESSAGE),
  recipientName: z
    .string()
    .trim()
    .min(1, RECIPIENT_NAME_MESSAGE)
    .max(GIFT_NAME_MAX, GIFT_NAME_LENGTH_MESSAGE),
  recipientPhone: z.string().regex(PHONE_PATTERN, PHONE_MESSAGE),
});

/** Siparis ayrintilari (POST /v1/orders `details`); sozlesme onayi zorunludur. */
export const orderDetailsSchema = z.object({
  gift: giftDetailsSchema.optional(),
  note: z.string().trim().max(CHECKOUT_TEXT_MAX, NOTE_LENGTH_MESSAGE),
  doNotRingBell: z.boolean(),
  agreementsAccepted: z.literal(true, { errorMap: () => ({ message: AGREEMENTS_MESSAGE }) }),
});

/**
 * Cevaptaki hediye: istek kurallari (kirpma, sinirlar) cevabi DOGRULAMAZ;
 * kurallar sikilasa da eski siparis okunur. `enabled` yok: alanin varligi
 * hediyedir (proto GiftDetails'ta da yok).
 */
export const giftDetailsViewSchema = z.object({
  message: z.string(),
  senderName: z.string(),
  recipientName: z.string(),
  recipientPhone: z.string(),
});

/**
 * Siparisin ayrintilari cevapta (GET /v1/orders/{id}; yalnizca SAHIBINE):
 * onayin sunucu saatiyle ani da doner.
 */
export const orderDetailsViewSchema = z.object({
  gift: giftDetailsViewSchema.optional(),
  note: z.string(),
  doNotRingBell: z.boolean(),
  agreementsAccepted: z.boolean(),
  agreementsAcceptedAt: isoDateTimeSchema,
});

export type GiftDetails = z.infer<typeof giftDetailsSchema>;
export type OrderDetails = z.infer<typeof orderDetailsSchema>;
export type GiftDetailsView = z.infer<typeof giftDetailsViewSchema>;
export type OrderDetailsView = z.infer<typeof orderDetailsViewSchema>;
