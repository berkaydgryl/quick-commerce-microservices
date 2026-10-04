/**
 * Telefon numarasini degistirme ve dogrulama (T11.14 PR 3; ADR-12 2. eki):
 *   POST /v1/me/phone/code    numaraya 6 haneli kod gonderir (SMS)
 *   POST /v1/me/phone/verify  kodu dogrular, numarayi hesaba yazar
 *
 * Telefon GIRIS KIMLIGIDIR: baska bir numaraya gecmek icin simdiki sifre
 * sorulur (calinmis oturum hesabi ele gecirmesin). Simdiki numarayi dogrulamak
 * ("Doğrula") sifre istemez. Basarili degisiklikte bu oturum disindaki butun
 * oturumlar kapanir. Numara baska hesapta kayitliysa PHONE_ALREADY_REGISTERED
 * (alan cumlesi details.phone'da); yanlis sifre VALIDATION_FAILED (password).
 * Kurallar e-postayla ayni (VERIFICATION_CODE_*). Gelistirmede SMS Mailpit'e
 * duser; production'da uc baglanmaz (gercek SMS saglayicisi bekleyen is #95).
 */

import { z } from 'zod';

import { passwordSchema, phoneSchema } from './auth.js';
import { verificationCodeSchema } from './verification.js';

/**
 * POST /v1/me/phone/code govdesi. `password` numara DEGISIRKEN zorunludur
 * (sunucu soyler); simdiki numarayi dogrularken gonderilmez.
 */
export const sendPhoneCodeRequestSchema = z.object({
  phone: phoneSchema,
  password: passwordSchema.optional(),
});

/** POST /v1/me/phone/code cevabi (202): numara, kalan gecerlilik ve bekleme (saniye). */
export const phoneCodeSentSchema = z.object({
  phone: phoneSchema,
  expiresInSeconds: z.number().int().positive(),
  resendAfterSeconds: z.number().int().nonnegative(),
});

/**
 * POST /v1/me/phone/verify govdesi. Numara da gonderilir: bekleyenle
 * eslesmeyen istek "suresi doldu" sayilir. Cevap guncel profildir
 * (userProfileSchema; phone yeni numara, phoneVerified true).
 */
export const verifyPhoneRequestSchema = z.object({
  phone: phoneSchema,
  code: verificationCodeSchema,
});

export type SendPhoneCodeRequest = z.infer<typeof sendPhoneCodeRequestSchema>;
export type PhoneCodeSent = z.infer<typeof phoneCodeSentSchema>;
export type VerifyPhoneRequest = z.infer<typeof verifyPhoneRequestSchema>;
