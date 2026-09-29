/**
 * Kayit ve giris formlarinin semalari (T8.5). Kurallar ve mesajlar sozlesmeden
 * gelir (@getir/contracts auth.ts); gateway ayni kurallari ayni cumlelerle
 * uygular (rules_contract_test.go iki tarafi karsilastirir).
 *
 * Telefon alani onekten sonraki 10 rakami tutar: dogrulamadan once "+90"
 * eklenir ve sozlesmenin E.164 kuralina bakilir. Formun gonderdigi deger
 * dogrudan istek govdesidir (LoginRequest, RegisterRequest).
 */

import { fullNameSchema, passwordSchema, phoneSchema } from '@getir/contracts';
import type { LoginRequest, RegisterRequest } from '@getir/contracts';
import { z } from 'zod';

import { toE164 } from './phone';

const formPhoneSchema = z.string().transform(toE164).pipe(phoneSchema);

export const loginFormSchema = z.object({
  phone: formPhoneSchema,
  password: passwordSchema,
}) satisfies z.ZodType<LoginRequest, z.ZodTypeDef, unknown>;

export const registerFormSchema = z.object({
  fullName: fullNameSchema,
  phone: formPhoneSchema,
  password: passwordSchema,
}) satisfies z.ZodType<RegisterRequest, z.ZodTypeDef, unknown>;

/** Formun tuttugu degerler: telefon 10 rakam. */
export type LoginFormValues = z.input<typeof loginFormSchema>;
export type RegisterFormValues = z.input<typeof registerFormSchema>;

export type LoginField = keyof LoginFormValues;
export type RegisterField = keyof RegisterFormValues;

/** Sunucu hatasinin baglanabilecegi alanlar (server-errors.ts). */
export const LOGIN_FIELDS: readonly LoginField[] = ['phone', 'password'];
export const REGISTER_FIELDS: readonly RegisterField[] = ['fullName', 'phone', 'password'];

export const EMPTY_LOGIN_FORM: LoginFormValues = { phone: '', password: '' };
export const EMPTY_REGISTER_FORM: RegisterFormValues = { fullName: '', phone: '', password: '' };
