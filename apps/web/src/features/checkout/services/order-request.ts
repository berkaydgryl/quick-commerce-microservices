/**
 * Siparis govdesi (T12.4; B1/B2): POST /v1/orders. Sema sozlesmeden
 * (@getir/contracts createOrderRequestSchema): gateway ayni kurali uygular,
 * istemci kendi kopyasini tutmaz.
 *
 * Govdede kart verisi YOK (M7): yalnizca kasanin kart kimligi (cardId) ya da
 * kapida odemenin turu (F12; payment-choice.ts).
 * Kisisel veri (alici adi ve telefonu, notlar) yalnizca bu govdede gider;
 * gunluge, depoya ve adrese yazilmaz.
 */

import { createOrderRequestSchema } from '@getir/contracts';
import type { CreateOrderRequest } from '@getir/contracts';

import { toE164 } from '../../auth/services/phone';

import type { CheckoutForm } from './checkout-rules';
import { paymentInput } from './payment-choice';
import type { PaymentChoice } from './payment-choice';

/**
 * Formdan siparis govdesi: hediye kapaliysa gift yok; adlar ve notlar
 * kirpilir; telefon E.164 ("+905321234567"). Kurala uymayan form (sozlesme
 * onaysiz, alici adi bos, sinir asimi) icin govde KURULMAZ (hata): dugme
 * zaten pasiftir (order-readiness), son kapi prepare-order.
 */
export function buildOrderRequest(
  orderId: string,
  payment: PaymentChoice,
  form: CheckoutForm,
): CreateOrderRequest {
  const { gift } = form;
  return createOrderRequestSchema.parse({
    orderId,
    payment: paymentInput(payment),
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
