/**
 * Siparis govdesi - TASLAK (T12.4; PM karari M3).
 *
 * B1 (kayitli kartla odeme: payment.cardId) ve B2 (hediye, not, "Zili Çalma",
 * sozlesme onayi: details) backend'de HENUZ YOK; gateway bugun bu alanlari
 * bilinmeyen alan diye reddeder (400). Sema ve kurulus YALNIZCA burada durur:
 * B1/B2 birlesince @getir/contracts'a (createOrderRequestSchema) tasinir ve bu
 * dosya oradan beslenir. Canli testte POST /v1/orders taklit edilir.
 *
 * Govdede kart verisi YOK (M7): yalnizca kasanin kart kimligi (cardId).
 * Kisisel veri (alici adi ve telefonu, notlar) yalnizca bu govdede gider;
 * gunluge, depoya ve adrese yazilmaz.
 */

import { cardIdSchema, idSchema, PHONE_PATTERN } from '@getir/contracts';
import { z } from 'zod';

import { toE164 } from '../../auth/services/phone';

import { CHECKOUT_TEXT_MAX, GIFT_NAME_MAX } from './checkout-rules';
import type { CheckoutForm } from './checkout-rules';

const giftDraftSchema = z.object({
  enabled: z.literal(true),
  message: z.string().max(CHECKOUT_TEXT_MAX),
  senderName: z.string().max(GIFT_NAME_MAX),
  recipientName: z.string().trim().min(1).max(GIFT_NAME_MAX),
  recipientPhone: z.string().regex(PHONE_PATTERN),
});

export const placeOrderDraftSchema = z.object({
  orderId: idSchema,
  payment: z.object({ method: z.literal('CARD'), cardId: cardIdSchema }),
  details: z.object({
    /** Hediye kapaliysa alan yok (alanlar gonderilmez). */
    gift: giftDraftSchema.optional(),
    note: z.string().max(CHECKOUT_TEXT_MAX),
    doNotRingBell: z.boolean(),
    agreementsAccepted: z.literal(true),
  }),
});

export type PlaceOrderDraft = z.infer<typeof placeOrderDraftSchema>;

/**
 * Formdan taslak govde: hediye kapaliysa gift yok; adlar ve notlar kirpilir;
 * telefon E.164 ("+905321234567"). Sozlesme onaysizsa govde KURULMAZ (hata):
 * dugme zaten pasiftir (order-readiness).
 */
export function buildPlaceOrderDraft(
  orderId: string,
  cardId: string,
  form: CheckoutForm,
): PlaceOrderDraft {
  const { gift } = form;
  return placeOrderDraftSchema.parse({
    orderId,
    payment: { method: 'CARD', cardId },
    details: {
      ...(gift.enabled
        ? {
            gift: {
              enabled: true,
              message: gift.message.trim(),
              senderName: gift.senderName.trim(),
              recipientName: gift.recipientName.trim(),
              recipientPhone: toE164(gift.recipientPhone),
            },
          }
        : {}),
      note: form.note.trim(),
      doNotRingBell: form.doNotRingBell,
      agreementsAccepted: form.agreementsAccepted,
    },
  });
}
