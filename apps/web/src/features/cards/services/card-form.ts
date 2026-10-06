/**
 * Kart ekleme formu (T11.17; duzen kullanicinin referansi getircarsi "Kart
 * Ekle"): alanlar, istemci kurallari ve istek. Kural fonksiyonlari ve
 * cumleleri SOZLESMEDEN (@getir/contracts card-rules.ts; kasa ayni
 * fonksiyonlarla yeniden denetler, karar sunucudadir). Icerikten yalnizca
 * secim ve onay uyarilari gelir.
 *
 * Numara ve CVV yalnizca form durumunda yasar (M7): istek bir kez gonderilir,
 * form kapaninca gider.
 */

import {
  CARD_FIELD_MESSAGES,
  cardExpiryProblem,
  cardHolderNameProblem,
  cardNicknameProblem,
  cardNumberProblem,
  cvvLengthOf,
  normalizeCardText,
} from '@getir/contracts';
import type { AddCardRequest } from '@getir/contracts';
import { AppError, ERROR_CODES } from '@getir/core';
import { z } from 'zod';

import { fieldReasons, formFeedback, retryAfterSeconds } from '../../auth/services/server-errors';
import type { FormFeedback } from '../../auth/services/server-errors';

import { typingBrand } from './card-input';

export interface CardFormValues {
  /** Istege bagli; bos = kart adi yok. */
  readonly nickname: string;
  /** Yalnizca rakamlar (gosterimde gruplanir). */
  readonly number: string;
  readonly holderName: string;
  /** "01".."12"; secilmediyse bos. */
  readonly expiryMonth: string;
  /** "2026".."2046" (sozlesmeden); secilmediyse bos. */
  readonly expiryYear: string;
  readonly cvv: string;
  /** Kullanim kosullari kabul edildi (zorunlu). */
  readonly terms: boolean;
}

export type CardFormField = keyof CardFormValues;

/** Alanlar, ekrandaki sirayla (ilk hatali alana odak bu sirayla). */
export const CARD_FORM_FIELDS: readonly CardFormField[] = [
  'nickname',
  'number',
  'holderName',
  'expiryMonth',
  'expiryYear',
  'cvv',
  'terms',
];

export const EMPTY_CARD_FORM: CardFormValues = {
  nickname: '',
  number: '',
  holderName: '',
  expiryMonth: '',
  expiryYear: '',
  cvv: '',
  terms: false,
};

/** Formun icerikten gelen uyarilari (kural cumleleri degil). */
export interface CardFormNotices {
  readonly expiryRequiredNotice: string;
  readonly termsRequiredNotice: string;
}

/** CVV kurali: rakam ve markanin uzunlugu (marka belli degilse 3 ya da 4). */
export function cvvProblem(cvv: string, number: string): string | null {
  const brand = typingBrand(number);
  const valid =
    /^\d+$/.test(cvv) &&
    (brand === null ? cvv.length === 3 || cvv.length === 4 : cvv.length === cvvLengthOf(brand));
  return valid ? null : CARD_FIELD_MESSAGES.cvv;
}

function addProblem(context: z.RefinementCtx, problem: string | null): void {
  if (problem !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  }
}

/** Formun istemci semasi; `now` son kullanma denetiminin ani (testte sabit). */
export function cardFormSchema(notices: CardFormNotices, now: () => Date = () => new Date()) {
  const chosen = (value: string, context: z.RefinementCtx) => {
    if (value === '') {
      context.addIssue({ code: z.ZodIssueCode.custom, message: notices.expiryRequiredNotice });
    }
  };
  return z
    .object({
      nickname: z
        .string()
        .superRefine((value, context) =>
          addProblem(context, cardNicknameProblem(normalizeCardText(value))),
        ),
      number: z
        .string()
        .superRefine((value, context) => addProblem(context, cardNumberProblem(value))),
      holderName: z
        .string()
        .superRefine((value, context) =>
          addProblem(context, cardHolderNameProblem(normalizeCardText(value))),
        ),
      expiryMonth: z.string().superRefine(chosen),
      expiryYear: z.string().superRefine(chosen),
      cvv: z.string(),
      terms: z.boolean().refine((accepted) => accepted, notices.termsRequiredNotice),
    })
    .superRefine(({ number, cvv, expiryMonth, expiryYear }, context) => {
      const cvvIssue = cvvProblem(cvv, number);
      if (cvvIssue !== null) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['cvv'], message: cvvIssue });
      }
      if (expiryMonth === '' || expiryYear === '') {
        return;
      }
      const expiry = cardExpiryProblem(Number(expiryMonth), Number(expiryYear), now());
      if (expiry !== null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [expiry.field],
          message: expiry.message,
        });
      }
    });
}

/**
 * Formdan istek: numara rakamlari, ay ve yil sayi, CVV, ad (NFC + kirpilmis);
 * bos kart adi gonderilmez. Kosul onayi istemcidedir, govdeye girmez. Sema
 * gectikten sonra cagrilir.
 */
export function toAddCardRequest(values: CardFormValues): AddCardRequest {
  const nickname = normalizeCardText(values.nickname);
  return {
    number: values.number,
    expiryMonth: Number(values.expiryMonth),
    expiryYear: Number(values.expiryYear),
    cvv: values.cvv,
    holderName: normalizeCardText(values.holderName),
    ...(nickname === '' ? {} : { nickname }),
  };
}

/** Istegin alanlari formdaki alanlara (ayni adlar; kosul onayi istekte yok). */
const REQUEST_FIELDS: readonly CardFormField[] = [
  'number',
  'holderName',
  'expiryMonth',
  'expiryYear',
  'cvv',
  'nickname',
];

/** Alan istegin govdesine girer mi (kosul onayi girmez; deneme anahtari yalniz bunlarla degisir, QA D2). */
export function isRequestField(name: string): name is CardFormField {
  return REQUEST_FIELDS.some((field) => field === name);
}

/** CONFLICT ayrintisi: ayni kart kullanicinin kasasinda var (kartin kimligi). */
const duplicateCardSchema = z.object({ cardId: z.string().min(1) });

/**
 * Sunucu hatasi -> form. Alan cumleleri alanlarin altina; alani olmayan cumle
 * (dolu kasa: "En fazla 10 kart kaydedebilirsin") formun ustune, oldugu gibi.
 * Ayni kart (CONFLICT + cardId, QA C4) icerigin cumlesiyle; diger CONFLICT,
 * saglayici reddi (PAYMENT_DECLINED) ve gerisi sozlugun cumlesiyle ustte.
 */
export function cardFormFeedback(
  error: unknown,
  duplicateNotice: string,
): FormFeedback<CardFormField> {
  if (!(error instanceof AppError)) {
    return formFeedback(error, CARD_FORM_FIELDS);
  }
  if (error.code === ERROR_CODES.CONFLICT && duplicateCardSchema.safeParse(error.details).success) {
    return { fields: {}, message: duplicateNotice };
  }
  const reasons = error.code === ERROR_CODES.VALIDATION_FAILED ? fieldReasons(error.details) : null;
  if (reasons === null) {
    return formFeedback(error, CARD_FORM_FIELDS);
  }
  const fields: Partial<Record<CardFormField, string>> = {};
  let message: string | null = null;
  for (const [name, reason] of Object.entries(reasons)) {
    const field = REQUEST_FIELDS.find((candidate) => candidate === name);
    if (field === undefined) {
      message ??= reason;
    } else {
      fields[field] ??= reason;
    }
  }
  return { fields, message };
}

/**
 * Cok fazla basarisiz dogrulama (K2: 429 + Retry-After): tekrar denemeye
 * kalan saniye; hata baska turdeyse ya da sure yoksa null. Form bu sure
 * boyunca Devam'i kapatir ve geri sayar.
 */
export function retryWaitSeconds(error: unknown): number | null {
  if (!(error instanceof AppError) || error.code !== ERROR_CODES.RATE_LIMITED) {
    return null;
  }
  return retryAfterSeconds(error.details);
}
