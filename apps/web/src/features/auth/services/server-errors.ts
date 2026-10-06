/**
 * Sunucu hatasini forma cevirir (T8.5): hangi mesaj hangi alanin altinda,
 * hangisi formun ustunde gorunur. Mesajlar sozlukten gelir (@getir/contracts
 * errors.ts); dogrulama ayrintisi (details) sozlesmenin alan mesajlaridir.
 */

import { errorMessage } from '@getir/contracts';
import { AppError, ERROR_CODES } from '@getir/core';
import { z } from 'zod';

export interface FormFeedback<F extends string> {
  /** Alanin altinda gosterilecek mesajlar. */
  readonly fields: Partial<Record<F, string>>;
  /** Formun ustunde gosterilecek mesaj; alanlara baglanamayan hata. */
  readonly message: string | null;
}

/** VALIDATION_FAILED ayrintisi: alan -> sebep (gateway fieldErrors). */
const fieldReasonsSchema = z.record(z.string(), z.string());

/** RATE_LIMITED ayrintisi: tekrar denemeye kalan saniye (T8.2; Retry-After ile ayni). */
const retryAfterSchema = z.object({ retryAfterSeconds: z.number().int().positive() });

/**
 * VALIDATION_FAILED ayrintisi alan -> sebep olarak; okunamazsa null. Ayrintiyi
 * kendi alanlarina eslemesi gereken formlar (kart formu, T11.17) da bunu kullanir.
 */
export function fieldReasons(details: unknown): Readonly<Record<string, string>> | null {
  const reasons = fieldReasonsSchema.safeParse(details);
  return reasons.success ? reasons.data : null;
}

/** RATE_LIMITED ayrintisindaki kalan saniye; yoksa null (geri sayan formlar, T11.17). */
export function retryAfterSeconds(details: unknown): number | null {
  const retry = retryAfterSchema.safeParse(details);
  return retry.success ? retry.data.retryAfterSeconds : null;
}

export function formFeedback<F extends string>(
  error: unknown,
  fields: readonly F[],
): FormFeedback<F> {
  if (!(error instanceof AppError)) {
    return formMessage(errorMessage(ERROR_CODES.INTERNAL));
  }
  switch (error.code) {
    case ERROR_CODES.VALIDATION_FAILED:
      return validationFeedback(error.details, fields);
    case ERROR_CODES.PHONE_ALREADY_REGISTERED:
      return onField('phone', errorMessage(error.code), fields);
    case ERROR_CODES.RATE_LIMITED:
      return formMessage(rateLimitedMessage(error.details));
    default:
      return formMessage(errorMessage(error.code));
  }
}

function formMessage<F extends string>(message: string): FormFeedback<F> {
  return { fields: {}, message };
}

/** Mesaj alan formdaysa o alanin altina, degilse formun ustune. */
function onField<F extends string>(
  field: string,
  message: string,
  fields: readonly F[],
): FormFeedback<F> {
  const known = fields.find((candidate) => candidate === field);
  if (known === undefined) {
    return formMessage(message);
  }
  const fieldMessages: Partial<Record<F, string>> = {};
  fieldMessages[known] = message;
  return { fields: fieldMessages, message: null };
}

/**
 * Bilinen alanlarin sebepleri alanlarin altina. Formda karsiligi olmayan bir
 * ayrinti (baslik, cerez) ya da okunamayan ayrinti formun ustunde genel mesaj olur.
 */
function validationFeedback<F extends string>(
  details: unknown,
  fields: readonly F[],
): FormFeedback<F> {
  const reasons = fieldReasons(details);
  if (reasons === null) {
    return formMessage(errorMessage(ERROR_CODES.VALIDATION_FAILED));
  }
  const fieldMessages: Partial<Record<F, string>> = {};
  let unmatched = false;
  for (const [name, reason] of Object.entries(reasons)) {
    const field = fields.find((candidate) => candidate === name);
    if (field === undefined) {
      unmatched = true;
    } else {
      fieldMessages[field] = reason;
    }
  }
  const matchedAny = Object.keys(fieldMessages).length > 0;
  return {
    fields: fieldMessages,
    message: unmatched || !matchedAny ? errorMessage(ERROR_CODES.VALIDATION_FAILED) : null,
  };
}

/** "Cok fazla deneme yaptin. Kisa bir sure sonra tekrar dene. (42 sn)" */
function rateLimitedMessage(details: unknown): string {
  const base = errorMessage(ERROR_CODES.RATE_LIMITED);
  const seconds = retryAfterSeconds(details);
  return seconds === null ? base : `${base} (${seconds} sn)`;
}
