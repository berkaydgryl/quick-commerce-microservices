/**
 * Kimlik formlarinin semalari (T8.5; T11.6'dan beri ulke kodu seciciden).
 * Kurallar ve mesajlar sozlesmeden gelir (@getir/contracts auth.ts); gateway
 * ayni kurallari ayni cumlelerle uygular (rules_contract_test.go iki tarafi
 * karsilastirir).
 *
 * Telefon alani koddan sonraki 10 rakami tutar: dogrulamadan once secili
 * ulkenin kodu eklenir ve sozlesmenin E.164 kuralina bakilir. Giris ve kayit
 * formunun gonderdigi deger dogrudan istek govdesidir (LoginRequest,
 * RegisterRequest).
 */

import { fullNameSchema, passwordSchema, phoneSchema } from '@getir/contracts';
import type { LoginRequest, RegisterRequest } from '@getir/contracts';
import { z } from 'zod';

import { toE164 } from './phone';

function formPhoneSchema(dialCode: string) {
  return z
    .string()
    .transform((digits) => toE164(digits, dialCode))
    .pipe(phoneSchema);
}

/** Karsilama kartinin telefon formu: gecerli numara giris ekranina tasinir. */
export function phoneEntrySchema(dialCode: string) {
  return z.object({ phone: formPhoneSchema(dialCode) });
}

export function loginFormSchema(dialCode: string) {
  return z.object({
    phone: formPhoneSchema(dialCode),
    password: passwordSchema,
  }) satisfies z.ZodType<LoginRequest, z.ZodTypeDef, unknown>;
}

export function registerFormSchema(dialCode: string) {
  return z.object({
    fullName: fullNameSchema,
    phone: formPhoneSchema(dialCode),
    password: passwordSchema,
  }) satisfies z.ZodType<RegisterRequest, z.ZodTypeDef, unknown>;
}

/** Formlarin tuttugu degerler: telefon 10 rakam. */
export type PhoneEntryValues = z.input<ReturnType<typeof phoneEntrySchema>>;
export type PhoneEntryOutput = z.output<ReturnType<typeof phoneEntrySchema>>;
export type LoginFormValues = z.input<ReturnType<typeof loginFormSchema>>;
export type RegisterFormValues = z.input<ReturnType<typeof registerFormSchema>>;

export type LoginField = keyof LoginFormValues;
export type RegisterField = keyof RegisterFormValues;

/** Sunucu hatasinin baglanabilecegi alanlar, EKRANDAKI sirayla (server-errors.ts, form-errors.ts). */
export const LOGIN_FIELDS: readonly LoginField[] = ['phone', 'password'];
export const REGISTER_FIELDS: readonly RegisterField[] = ['fullName', 'phone', 'password'];
