/**
 * Kimlik uclarinin semalari (T8.1):
 *   POST /v1/auth/register  POST /v1/auth/login  POST /v1/auth/refresh
 *   POST /v1/auth/logout    GET  /v1/me
 *
 * Kimlik TELEFON + SIFRE ile kurulur (ADR-12). Kayit e-posta almaz. E-posta
 * T11.14'ten beri profilde DOGRULANARAK eklenen bir iletisim alanidir, kimlik
 * degildir (ADR-12 eki; email.ts): profilde yalnizca dogrulanmis adres gorunur.
 *
 * Oturum iki jetondur: kisa omurlu ERISIM jetonu (JWT, JWT_TTL) her istekte
 * `Authorization: Bearer` basliginda gider; uzun omurlu YENILEME jetonu
 * (REFRESH_TTL) yalnizca /v1/auth/refresh ve /v1/auth/logout'a gider. Yenileme
 * jetonu sunucuda yalnizca ozetiyle (hash) saklanir ve her kullanimda
 * yenisiyle degisir: calinan eski jeton ikinci kez kullanilamaz.
 *
 * Alan mesajlari KULLANICIYA gorunur: web kayit ve giris formu bu semalarla
 * dogrular (T8.5) ve cumleyi alanin altinda gosterir. Bu yuzden Turkce
 * karakterlerle yazilir; gateway ayni cumleleri doner (rules.go,
 * rules_contract_test.go iki tarafi karsilastirir). Projedeki diger alan
 * sebepleri (katalog, siparis) bugun yalnizca API istemcisine gider ve ASCII'dir.
 */

import { z } from 'zod';

import { idSchema } from './common.js';
import {
  FULL_NAME_MAX_LENGTH,
  FULL_NAME_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PHONE_PATTERN,
} from './constants.js';
import { emailSchema } from './email.js';

/**
 * Telefon kuralinin cumlesi: sunucu (gateway) ve form ayni cumleyi gosterir.
 * Form ilk rakam 5 degilse numara bitmeden de bu cumleyi gosterir (T11.9).
 */
export const PHONE_MESSAGE =
  'Cep telefonu numarası 5 ile başlayan 10 rakam olmalı (örnek 532 123 45 67)';

/** E.164 bicimi cep telefonu; users.phone uzerinde unique indeks vardir. */
export const phoneSchema = z.string().regex(PHONE_PATTERN, PHONE_MESSAGE);

const utf8 = new TextEncoder();

/**
 * Sifre.
 *
 * Ust sinir BAYT cinsindendir, karakter degil: bcrypt girdinin ilk 72 baytini
 * kullanir. Karakter sayilsaydi Turkce harfler (ş, ğ: ikiser bayt) iceren
 * 72 karakterlik bir sifre sozlesmeden gecer, sunucuda reddedilirdi (T8.1).
 */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `en az ${PASSWORD_MIN_LENGTH} karakter olmalı`)
  .refine(
    (value) => utf8.encode(value).length <= PASSWORD_MAX_LENGTH,
    `en fazla ${PASSWORD_MAX_LENGTH} bayt olmalı (Türkçe harfler iki bayt sayılır)`,
  );

export const fullNameSchema = z
  .string()
  .trim()
  .min(FULL_NAME_MIN_LENGTH, `en az ${FULL_NAME_MIN_LENGTH} karakter olmalı`)
  .max(FULL_NAME_MAX_LENGTH, `en fazla ${FULL_NAME_MAX_LENGTH} karakter olmalı`);

export const registerRequestSchema = z.object({
  phone: phoneSchema,
  password: passwordSchema,
  fullName: fullNameSchema,
});

export const loginRequestSchema = z.object({
  phone: phoneSchema,
  password: passwordSchema,
});

/**
 * POST /v1/auth/password-reset (T11.9): "Sifremi unuttum". DEMO akisi
 * (kullanicinin karari): kimlik kanitlanmaz (SMS kodu yok); gateway ucu
 * yalnizca production DISINDA baglar. Cevap girisle aynidir (authSessionSchema):
 * eski oturumlar kapanir, yeni oturum acilir. Numarayla kayitli hesap yoksa
 * VALIDATION_FAILED (phone).
 */
export const resetPasswordRequestSchema = z.object({
  phone: phoneSchema,
  password: passwordSchema,
});

/**
 * POST /v1/auth/phone-check (T11.7): numarayla kayitli bir hesap var mi.
 * Karsilama ekraninin giris ve kayit penceresi numara yazilinca erken uyarir.
 * Bilincli odunlesim: cevap numaranin kayitli olup olmadigini soyler; uc IP
 * basina hiz sinirlidir. Numara govdededir: adres gunluklerine yazilmasin.
 */
export const phoneCheckRequestSchema = z.object({
  phone: phoneSchema,
});

export const phoneCheckResultSchema = z.object({
  registered: z.boolean(),
});

/*
 * Yenileme jetonu GOVDEDE TASINMAZ (T8.5 hazirligi): gateway onu HttpOnly
 * cereze yazar (getir_refresh; SameSite=Strict, Path=/v1/auth). Sayfadaki betik
 * jetonu goremez, XSS onu calamaz. POST /v1/auth/refresh ve /v1/auth/logout
 * govdesizdir: tarayici cerezi kendisi gonderir.
 */

/**
 * Cikis cevabi. revoked false HATA DEGILDIR: jeton zaten iptal edilmis ya da
 * suresi dolmus olabilir; istemci her iki durumda da yerel oturumu siler.
 */
export const logoutResultSchema = z.object({ revoked: z.boolean() });

/**
 * Istemciye giden kullanici. `email` yalnizca DOGRULANMIS adrestir (T11.14);
 * dogrulanmamis adres hesaba yazilmaz, alan yoksa kullanici e-posta eklememistir.
 */
export const userProfileSchema = z.object({
  id: idSchema,
  phone: phoneSchema,
  fullName: z.string(),
  email: emailSchema.optional(),
});

export const authSessionSchema = z.object({
  accessToken: z.string(),
  /** Tek desteklenen tur; istemci basligi "Bearer <token>" olarak kurar. */
  tokenType: z.literal('Bearer').optional(),
  /** Saniye cinsinden omur (JWT_TTL). Bitis ani DEGIL, SURE tasinir. */
  expiresIn: z.number().int().positive(),
  /**
   * Yenileme jetonunun (cerezdeki) saniye cinsinden omru (REFRESH_TTL): oturum en
   * cok bu kadar kullanilmadan kalabilir. Jetonun kendisi cerezdedir.
   */
  refreshExpiresIn: z.number().int().positive(),
  user: userProfileSchema,
});

export type Phone = z.infer<typeof phoneSchema>;
export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;
export type PhoneCheckRequest = z.infer<typeof phoneCheckRequestSchema>;
export type PhoneCheckResult = z.infer<typeof phoneCheckResultSchema>;
export type LogoutResult = z.infer<typeof logoutResultSchema>;
export type UserProfile = z.infer<typeof userProfileSchema>;
export type AuthSession = z.infer<typeof authSessionSchema>;
