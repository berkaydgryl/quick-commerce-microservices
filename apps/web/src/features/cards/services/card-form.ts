/**
 * Kart ekleme formu (T11.17): alanlar, istemci kurallari ve istek. Kural
 * fonksiyonlari ve cumleleri SOZLESMEDEN (@getir/contracts cards.ts; kasa ayni
 * fonksiyonlarla yeniden denetler, karar sunucudadir). Icerikten yalnizca
 * son kullanma bicim uyarisi gelir.
 *
 * Numara ve CVV yalnizca form durumunda yasar (M7): istek bir kez gonderilir,
 * form kapaninca gider.
 */

import {
  CARD_EXPIRY_MAX_YEARS_AHEAD,
  CARD_FIELD_MESSAGES,
  cardHolderNameProblem,
  cardNicknameProblem,
  cardNumberProblem,
  cvvLengthOf,
  isCardExpired,
  normalizeCardText,
} from '@getir/contracts';
import type { AddCardRequest } from '@getir/contracts';
import { AppError, ERROR_CODES } from '@getir/core';
import { z } from 'zod';

import { formFeedback } from '../../auth/services/server-errors';
import type { FormFeedback } from '../../auth/services/server-errors';

import { typingBrand } from './card-input';

export interface CardFormValues {
  /** Yalnizca rakamlar (gosterimde gruplanir). */
  readonly number: string;
  readonly holderName: string;
  /** "AA/YY". */
  readonly expiry: string;
  readonly cvv: string;
  /** Istege bagli; bos = kart adi yok. */
  readonly nickname: string;
}

export type CardFormField = keyof CardFormValues;

/** Alanlar, ekrandaki sirayla (ilk hatali alana odak bu sirayla). */
export const CARD_FORM_FIELDS: readonly CardFormField[] = [
  'number',
  'holderName',
  'expiry',
  'cvv',
  'nickname',
];

export const EMPTY_CARD_FORM: CardFormValues = {
  number: '',
  holderName: '',
  expiry: '',
  cvv: '',
  nickname: '',
};

const EXPIRY_PATTERN = /^(\d{2})\/(\d{2})$/;
const CENTURY = 2000;

/** "08/29" -> { month: 8, year: 2029 }; bicim eksikse null. */
export function parseExpiry(
  value: string,
): { readonly month: number; readonly year: number } | null {
  const match = EXPIRY_PATTERN.exec(value);
  if (match === null) {
    return null;
  }
  return { month: Number(match[1]), year: CENTURY + Number(match[2]) };
}

/**
 * Son kullanma kurali: bicim (icerikteki uyari), ay 1-12, gecmemis (Turkiye
 * saatiyle, sozlesme) ve en fazla CARD_EXPIRY_MAX_YEARS_AHEAD yil ileri.
 */
export function expiryProblem(value: string, now: Date, formatNotice: string): string | null {
  const parsed = parseExpiry(value);
  if (parsed === null) {
    return formatNotice;
  }
  if (parsed.month < 1 || parsed.month > 12) {
    return CARD_FIELD_MESSAGES.expiryMonth;
  }
  if (isCardExpired(parsed.month, parsed.year, now)) {
    return CARD_FIELD_MESSAGES.expired;
  }
  if (parsed.year > now.getFullYear() + CARD_EXPIRY_MAX_YEARS_AHEAD) {
    return CARD_FIELD_MESSAGES.expiryYear;
  }
  return null;
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
export function cardFormSchema(formatNotice: string, now: () => Date = () => new Date()) {
  return z
    .object({
      number: z
        .string()
        .superRefine((value, context) => addProblem(context, cardNumberProblem(value))),
      holderName: z
        .string()
        .superRefine((value, context) =>
          addProblem(context, cardHolderNameProblem(normalizeCardText(value))),
        ),
      expiry: z
        .string()
        .superRefine((value, context) =>
          addProblem(context, expiryProblem(value, now(), formatNotice)),
        ),
      cvv: z.string(),
      nickname: z
        .string()
        .superRefine((value, context) =>
          addProblem(context, cardNicknameProblem(normalizeCardText(value))),
        ),
    })
    .superRefine(({ number, cvv }, context) => {
      const problem = cvvProblem(cvv, number);
      if (problem !== null) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['cvv'], message: problem });
      }
    });
}

/**
 * Formdan istek: numara rakamlari, ay ve yil, CVV, ad (NFC + kirpilmis); bos
 * kart adi gonderilmez. Sema gectikten sonra cagrilir.
 */
export function toAddCardRequest(values: CardFormValues): AddCardRequest {
  const expiry = parseExpiry(values.expiry) ?? { month: 0, year: 0 };
  const nickname = normalizeCardText(values.nickname);
  return {
    number: values.number,
    expiryMonth: expiry.month,
    expiryYear: expiry.year,
    cvv: values.cvv,
    holderName: normalizeCardText(values.holderName),
    ...(nickname === '' ? {} : { nickname }),
  };
}

/** Istegin alanlari formdaki alanlara: son kullanma ayi ve yili tek alanda. */
const REQUEST_FIELD: Readonly<Record<string, CardFormField>> = {
  number: 'number',
  holderName: 'holderName',
  expiryMonth: 'expiry',
  expiryYear: 'expiry',
  cvv: 'cvv',
  nickname: 'nickname',
};

const fieldReasonsSchema = z.record(z.string(), z.string());

/** RATE_LIMITED ayrintisi: tekrar denemeye kalan saniye (gateway; Retry-After ile ayni). */
const retryAfterSchema = z.object({ retryAfterSeconds: z.number().int().positive() });

/**
 * Cok fazla basarisiz dogrulama (T11.17 K2: 429 + Retry-After): tekrar
 * denemeye kalan saniye; hata baska turdeyse ya da sure yoksa null. Form bu
 * sure boyunca kaydet dugmesini kapatir ve geri sayar.
 */
export function retryWaitSeconds(error: unknown): number | null {
  if (!(error instanceof AppError) || error.code !== ERROR_CODES.RATE_LIMITED) {
    return null;
  }
  const details = retryAfterSchema.safeParse(error.details);
  return details.success ? details.data.retryAfterSeconds : null;
}

/**
 * Sunucu hatasi -> form. Alan cumleleri alanlarin altina (ay ve yil "Son
 * kullanma" alanina); alani olmayan cumle (dolu kasa: "En fazla 10 kart
 * kaydedebilirsin") formun ustune, oldugu gibi. Ayni kart (CONFLICT) ve
 * saglayici reddi (PAYMENT_DECLINED) sozlugun cumlesiyle ustte.
 */
export function cardFormFeedback(error: unknown): FormFeedback<CardFormField> {
  if (!(error instanceof AppError) || error.code !== ERROR_CODES.VALIDATION_FAILED) {
    return formFeedback(error, CARD_FORM_FIELDS);
  }
  const reasons = fieldReasonsSchema.safeParse(error.details);
  if (!reasons.success) {
    return formFeedback(error, CARD_FORM_FIELDS);
  }
  const fields: Partial<Record<CardFormField, string>> = {};
  let message: string | null = null;
  for (const [name, reason] of Object.entries(reasons.data)) {
    const field = REQUEST_FIELD[name];
    if (field === undefined) {
      message ??= reason;
    } else {
      fields[field] ??= reason;
    }
  }
  return { fields, message };
}
