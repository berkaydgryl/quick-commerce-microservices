/**
 * gRPC istek semalari (Zod). Proto bicimi dogrular, KURALI dogrulamaz; kurallar
 * (tutar pozitif, kartta jeton zorunlu, anahtar zorunlu) burada calisir (ADR-10).
 */

import {
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
  OTP_PATTERN,
} from '@getir/contracts';
import { paymentV1 } from '@getir/proto';
import { z } from 'zod';

import { SUPPORTED_CURRENCY } from '../../config/constants.js';
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
      .transform((value) => (value === '' ? SUPPORTED_CURRENCY : value))
      .refine(
        (value) => value === SUPPORTED_CURRENCY,
        `yalnizca ${SUPPORTED_CURRENCY} desteklenir`,
      ),
  },
  { required_error: 'amount zorunlu' },
);

const idempotencyKey = z
  .string()
  .trim()
  .min(IDEMPOTENCY_KEY_MIN_LENGTH, `en az ${IDEMPOTENCY_KEY_MIN_LENGTH} karakter olmali`)
  .max(IDEMPOTENCY_KEY_MAX_LENGTH, `en fazla ${IDEMPOTENCY_KEY_MAX_LENGTH} karakter olmali`);

export const chargeRequestSchema = z
  .object({
    orderId: requiredText('orderId'),
    userId: requiredText('userId'),
    amount,
    method,
    cardToken: z.string().trim(),
    idempotencyKey,
  })
  .superRefine((input, ctx) => {
    const isCard = input.method === PAYMENT_METHOD.CARD;
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
