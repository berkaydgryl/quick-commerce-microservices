/**
 * Telefon adiminin formu ve sunucu hatalari (T11.14 PR 3). Numara alani
 * koddan sonraki 10 rakami tutar (+90 onekli); gonderilirken E.164'e cevrilir
 * ve sozlesmenin kuraliyla dogrulanir. Sifre kurali kayittakiyle ayni.
 */

import { passwordSchema, phoneSchema } from '@getir/contracts';
import { AppError, ERROR_CODES } from '@getir/core';
import { z } from 'zod';

import { toE164 } from '../../auth/services/phone';
import { formFeedback } from '../../auth/services/server-errors';
import type { FormFeedback } from '../../auth/services/server-errors';

/** Numara degistirme formu: yeni numara (10 rakam) ve simdiki sifre. */
export const phoneChangeFormSchema = z.object({
  phone: z
    .string()
    .transform((digits) => toE164(digits))
    .pipe(phoneSchema),
  password: passwordSchema,
});
export type PhoneChangeFormValues = z.input<typeof phoneChangeFormSchema>;
export type PhoneChangeRequest = z.output<typeof phoneChangeFormSchema>;
/** Sunucu hatasinin eslenebilecegi alanlar, ekrandaki sirayla. */
export const PHONE_CHANGE_FIELDS = ['phone', 'password'] as const;
/** Kod adiminda: kod alani; numara (bu arada baska hesapta) formun ustunde. */
export const PHONE_CODE_FIELDS = ['code', 'phone'] as const;

const phoneReasonSchema = z.object({ phone: z.string() });
const passwordReasonSchema = z.object({ password: z.string() });

/**
 * Yeniden gonderimde sifre istendi mi (karar a): bekleyen kod yasadikca
 * "Kodu yeniden gönder" sifresizdir; kodun omru (10 dk) dolunca sunucu sifreyi
 * yeniden sorar. Kod adimi bu durumda numarasi dolu forma doner.
 */
export function needsPassword(error: unknown): boolean {
  return (
    error instanceof AppError &&
    error.code === ERROR_CODES.VALIDATION_FAILED &&
    passwordReasonSchema.safeParse(error.details).success
  );
}

/**
 * Sunucu hatasi -> telefon formu. PHONE_ALREADY_REGISTERED'in sozlukteki
 * cumlesi girise davet eder ("Giriş yapmayı dener misin?"); numara
 * degistirirken yanlis olurdu. Bu yuzden sunucunun alan cumlesi
 * (details.phone: "Bu numara başka bir hesapta kayıtlı") kullanilir. Gerisi
 * kimlik formlarinin kurali (formFeedback).
 */
export function phoneFeedback<F extends string>(
  error: unknown,
  fields: readonly F[],
): FormFeedback<F> {
  if (error instanceof AppError && error.code === ERROR_CODES.PHONE_ALREADY_REGISTERED) {
    const reason = phoneReasonSchema.safeParse(error.details);
    if (reason.success) {
      const field = fields.find((candidate) => candidate === 'phone');
      if (field === undefined) {
        return { fields: {}, message: reason.data.phone };
      }
      const messages: Partial<Record<F, string>> = {};
      messages[field] = reason.data.phone;
      return { fields: messages, message: null };
    }
  }
  return formFeedback(error, fields);
}
