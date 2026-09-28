/**
 * gRPC istek semalari (Zod). Proto bicimi dogrular, KURALI dogrulamaz; kurallar
 * (tutar pozitif, kartta jeton zorunlu, anahtar zorunlu) burada calisir (ADR-10).
 */

import { idempotencyKeySchema, OTP_PATTERN, refundReasonSchema } from '@getir/contracts';
import { CURRENCY } from '@getir/core';
import { paymentV1 } from '@getir/proto';
import { z } from 'zod';

import { PAYMENT_METHOD } from '../../domain/payment.js';
import type { PaymentMethod } from '../../domain/payment.js';

const requiredText = (field: string) => z.string().trim().min(1, `${field} zorunlu`);

/**
 * Proto yontemi -> domain. Record TUM enum degerlerini ister: proto'ya yeni bir
 * yontem eklendiginde burasi DERLEMEDE kirilir (proje kurali). UNSPECIFIED ve
 * UNRECOGNIZED bilerek undefined: gecersiz istek sayilir.
 */
const METHOD_FROM_PROTO: Readonly<Record<paymentV1.PaymentMethod, PaymentMethod | undefined>> = {
  [paymentV1.PaymentMethod.PAYMENT_METHOD_UNSPECIFIED]: undefined,
  [paymentV1.PaymentMethod.PAYMENT_METHOD_CARD]: PAYMENT_METHOD.CARD,
  [paymentV1.PaymentMethod.PAYMENT_METHOD_CASH_ON_DELIVERY]: PAYMENT_METHOD.CASH_ON_DELIVERY,
  [paymentV1.PaymentMethod.UNRECOGNIZED]: undefined,
};

const method = z.nativeEnum(paymentV1.PaymentMethod).transform((value, ctx) => {
  const mapped = METHOD_FROM_PROTO[value];
  if (mapped === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'odeme yontemi zorunlu' });
    return z.NEVER;
  }
  return mapped;
});

/**
 * Tutar kurus cinsinden pozitif tam sayi. Istemciden GELMEZ; order-svc'nin
 * hesapladigi siparis toplamidir. Bos para birimi sozlesmede TRY demektir.
 */
const amount = z.object(
  {
    amountMinor: z.number().int().positive('tutar pozitif olmali'),
    currency: z
      .string()
      .transform((value) => (value === '' ? CURRENCY : value))
      .refine((value) => value === CURRENCY, `yalnizca ${CURRENCY} desteklenir`),
  },
  { required_error: 'amount zorunlu' },
);

export const chargeRequestSchema = z
  .object({
    orderId: requiredText('orderId'),
    userId: requiredText('userId'),
    amount,
    method,
    cardToken: z.string().trim(),
    idempotencyKey: idempotencyKeySchema,
    // proto3 bool: gonderilmezse false (3DS'i banka karari belirler).
    requireThreeDs: z.boolean(),
  })
  .superRefine((input, ctx) => {
    const isCard = input.method === PAYMENT_METHOD.CARD;
    // Kapida odemede dogrulanacak kart yok: istek celiskili, sessizce yok sayilmaz.
    if (!isCard && input.requireThreeDs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['requireThreeDs'],
        message: 'kapida odemede 3DS istenemez',
      });
    }
    if (isCard && input.cardToken === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cardToken'],
        message: 'kartli odemede zorunlu',
      });
    }
    // Kapida odemede jeton sessizce yok sayilmaz: istemci yontemi yanlis secmis olabilir.
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
    cardToken: cardToken === '' ? undefined : cardToken,
  }));

export type ChargeRequestInput = z.infer<typeof chargeRequestSchema>;

/**
 * Confirm3Ds. Kod bicimi (6 hane) sozlesmedeki OTP kuraliyla ayni. Bicimi
 * bozuk kod DENEME SAYILMAZ: VALIDATION_FAILED doner, hak dusmez - yazim hatasi
 * yuzunden kullanicinin hakki yanmasin.
 */
export const confirm3DsRequestSchema = z.object({
  orderId: requiredText('orderId'),
  challengeId: requiredText('challengeId'),
  code: z.string().trim().regex(OTP_PATTERN, '6 haneli kod olmali'),
});

export type Confirm3DsRequestInput = z.infer<typeof confirm3DsRequestSchema>;

/**
 * Refund (T7.1). Iade de bir mutasyondur (ADR-08): anahtar zorunlu. Tekrar
 * korumasi kaydin durumundadir (zaten REFUNDED ise ikinci iade yapilmaz),
 * anahtar burada yalnizca varlik ve bicim olarak dogrulanir. Gerekce ve
 * anahtar kurali payment.refund_requested olayiyla ORTAKTIR (@getir/contracts,
 * T7.4): ayni iade iki yoldan farkli kuralla gelmesin.
 */
export const refundRequestSchema = z.object({
  orderId: requiredText('orderId'),
  reason: refundReasonSchema,
  idempotencyKey: idempotencyKeySchema,
});

export type RefundRequestInput = z.infer<typeof refundRequestSchema>;
