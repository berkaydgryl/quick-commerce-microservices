/**
 * CreateOrder gRPC istek semasi (T7.1; T12.4): odeme yontemi, kart kaynagi,
 * risk sinyalleri ve siparis ayrintilari. schemas.ts'ten ayrildi (SRP, satir
 * siniri); ortak parcalar (requiredText, idempotencyKey) oradan gelir.
 */

import {
  cardIdSchema,
  geoPointSchema,
  giftDetailsSchema,
  orderDetailsSchema,
} from '@getir/contracts';
import { paymentV1 } from '@getir/proto';
import { z } from 'zod';

import { MAX_SIGNAL_TEXT_LENGTH } from '../../config/constants.js';
import { PAYMENT_METHOD } from '../../domain/checkout-payment.js';
import type { PaymentMethod } from '../../domain/checkout-payment.js';
import type { CheckoutSignals } from '../../domain/checkout-risk.js';
import type { OrderDetailsInput } from '../../domain/order-details.js';
import { idempotencyKey, requiredText } from './schemas.js';

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
 * Siparis ayrintilari (T12.4; B2). Kurallar TEK kaynaktan: @getir/contracts
 * checkout-rules.ts (web formu ve gateway de ayni semayi kullanir). Proto'da
 * hediyenin `enabled` alani yok: mesajin varligi hediyedir. Istekteki
 * agreements_accepted_at yok sayilir (onayin ani sunucu saatiyle yazilir).
 *
 * ZORUNLU (kapida odemede de): sozlesme onayi yontemden bagimsiz bir urun
 * kuralidir ve siparisin sahibi olan servis uygular. Hata cumleleri degeri
 * YANKILAMAZ (kisisel veri hata ayrintisina girmez).
 */
const orderDetails = z
  .object(
    {
      ...orderDetailsSchema.omit({ gift: true }).shape,
      gift: giftDetailsSchema.omit({ enabled: true }).optional(),
    },
    { required_error: 'siparis ayrintilari zorunlu' },
  )
  .transform(({ gift, note, doNotRingBell }): OrderDetailsInput => ({
    ...(gift === undefined ? {} : { gift }),
    note,
    doNotRingBell,
  }));

/**
 * CreateOrder (T7.1; T12.4). Kartli odemede kasadaki kart (card_id) ya da eski
 * test jetonu (card_token, DEPRECATED) - TAM biri; kapida odemede ikisi de bos
 * olmali (istemci yontemi yanlis secmis olabilir, sessizce yok sayilmaz).
 * payment-svc'deki kuralla ayni. Kapida odemenin RISK bandina gore kapali
 * olmasi is kuralidir, use-case'tedir.
 */
export const createOrderRequestSchema = z
  .object({
    orderId: requiredText('orderId'),
    userId: requiredText('userId'),
    paymentMethod,
    cardToken: z.string().trim(),
    // Kayitli kart (T12.4): bos = yok (proto3 varsayilani).
    cardId: z.union([z.literal(''), cardIdSchema]),
    idempotencyKey,
    signals: checkoutSignals,
    details: orderDetails,
  })
  .superRefine((input, ctx) => {
    // Yontem gecersizse kart kurali ikinci bir hata uretmesin: istemci once yontemi duzeltir.
    const knownMethods: readonly unknown[] = Object.values(PAYMENT_METHOD);
    if (!knownMethods.includes(input.paymentMethod)) {
      return;
    }
    const isCard = input.paymentMethod === PAYMENT_METHOD.CARD;
    const sources = [input.cardId, input.cardToken].filter((value) => value !== '').length;
    const issue = (message: string, field: 'cardId' | 'cardToken' = 'cardId') =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message });
    if (isCard && sources === 0) {
      issue('kartli odemede card_id ya da card_token zorunlu');
    }
    if (isCard && sources > 1) {
      issue('card_id ile card_token birlikte gonderilemez');
    }
    // Kapida odemede hata, istemcinin GONDERDIGI alanda (eski istemci card_token yollar).
    if (!isCard && sources > 0) {
      issue('kapida odemede kart bos olmali', input.cardId === '' ? 'cardToken' : 'cardId');
    }
  })
  .transform(({ cardToken, cardId, ...rest }) => ({
    ...rest,
    ...(cardId === '' ? {} : { cardId }),
    ...(cardToken === '' ? {} : { cardToken }),
  }));

export type CreateOrderRequestInput = z.infer<typeof createOrderRequestSchema>;
