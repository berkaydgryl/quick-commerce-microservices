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

import {
  fullNameSchema,
  PHONE_MESSAGE,
  PHONE_MOBILE_PREFIX,
  passwordSchema,
  phoneSchema,
} from '@getir/contracts';
import type { LoginRequest, RegisterRequest, ResetPasswordRequest } from '@getir/contracts';
import { z } from 'zod';

import { PHONE_COUNTRY_PREFIX, toE164 } from './phone';

function formPhoneSchema(dialCode: string) {
  return z
    .string()
    .transform((digits) => toE164(digits, dialCode))
    .pipe(phoneSchema);
}

/**
 * Tamamlanmis numara (T11.7: numara kontrolu): formdaki rakamlar ve ulke kodu
 * sozlesmenin E.164 kuralina uyuyorsa E.164, uymuyorsa null. Eksik numara
 * sunucuya sorulmaz.
 */
export function completePhone(digits: string, dialCode: string): string | null {
  const parsed = formPhoneSchema(dialCode).safeParse(digits);
  return parsed.success ? parsed.data : null;
}

/**
 * Numara BITMEDEN belli olan hata (T11.9): Turkiye'de cep numarasi 5 ile
 * baslar (PHONE_PATTERN); ilk rakam baska ise kalan rakamlar ne olursa olsun
 * numara gecersizdir ve form gonderimi beklemeden sozlesmenin cumlesini
 * gosterir. Bos ya da 5'le baslayan eksik numara burada hata degildir: eksiklik
 * gonderimde soylenir (yazarken her rakamda hata gostermek rahatsiz ederdi).
 */
export function earlyPhoneProblem(digits: string, dialCode: string): string | undefined {
  if (
    dialCode !== PHONE_COUNTRY_PREFIX ||
    digits === '' ||
    digits.startsWith(PHONE_MOBILE_PREFIX)
  ) {
    return undefined;
  }
  return PHONE_MESSAGE;
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

/** Sifre yenileme formu (T11.9): telefon ve yeni sifre (kayittaki sifre kurali). */
export function resetPasswordFormSchema(dialCode: string) {
  return z.object({
    phone: formPhoneSchema(dialCode),
    password: passwordSchema,
  }) satisfies z.ZodType<ResetPasswordRequest, z.ZodTypeDef, unknown>;
}

/** Formlarin tuttugu degerler: telefon 10 rakam. */
export type PhoneEntryValues = z.input<ReturnType<typeof phoneEntrySchema>>;
export type PhoneEntryOutput = z.output<ReturnType<typeof phoneEntrySchema>>;
export type LoginFormValues = z.input<ReturnType<typeof loginFormSchema>>;
export type RegisterFormValues = z.input<ReturnType<typeof registerFormSchema>>;
export type ResetPasswordFormValues = z.input<ReturnType<typeof resetPasswordFormSchema>>;

export type LoginField = keyof LoginFormValues;
export type RegisterField = keyof RegisterFormValues;
export type ResetPasswordField = keyof ResetPasswordFormValues;

/** Sunucu hatasinin baglanabilecegi alanlar, EKRANDAKI sirayla (server-errors.ts, form-errors.ts). */
export const LOGIN_FIELDS: readonly LoginField[] = ['phone', 'password'];
export const REGISTER_FIELDS: readonly RegisterField[] = ['fullName', 'phone', 'password'];
export const RESET_PASSWORD_FIELDS: readonly ResetPasswordField[] = ['phone', 'password'];
