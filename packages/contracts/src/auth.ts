/**
 * Kimlik uclarinin semalari (T8.1):
 *   POST /v1/auth/register  POST /v1/auth/login  POST /v1/auth/refresh
 *   POST /v1/auth/logout    GET  /v1/me
 *
 * Kimlik TELEFON + SIFRE ile kurulur (ADR-12). E-posta toplanmaz: SMS/OTP
 * altyapisi kurulmadigi icin dogrulanamayan bir alan kimlik alani olarak
 * kullanilamaz.
 *
 * Oturum iki jetondur: kisa omurlu ERISIM jetonu (JWT, JWT_TTL) her istekte
 * `Authorization: Bearer` basliginda gider; uzun omurlu YENILEME jetonu
 * (REFRESH_TTL) yalnizca /v1/auth/refresh ve /v1/auth/logout'a gider. Yenileme
 * jetonu sunucuda yalnizca ozetiyle (hash) saklanir ve her kullanimda
 * yenisiyle degisir: calinan eski jeton ikinci kez kullanilamaz.
 *
 * Mesajlar Turkce: web kayit ve giris formunu bu semalarla dogrular (T8.5).
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

/** E.164 bicimi telefon; users.phone uzerinde unique indeks vardir. */
export const phoneSchema = z
  .string()
  .regex(PHONE_PATTERN, '+90 ile baslayan 13 karakter olmali (ornek +905321234567)');

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
  .min(PASSWORD_MIN_LENGTH, `en az ${PASSWORD_MIN_LENGTH} karakter olmali`)
  .refine(
    (value) => utf8.encode(value).length <= PASSWORD_MAX_LENGTH,
    `en fazla ${PASSWORD_MAX_LENGTH} bayt olmali (Turkce harfler iki bayt sayilir)`,
  );

export const fullNameSchema = z
  .string()
  .trim()
  .min(FULL_NAME_MIN_LENGTH, `en az ${FULL_NAME_MIN_LENGTH} karakter olmali`)
  .max(FULL_NAME_MAX_LENGTH, `en fazla ${FULL_NAME_MAX_LENGTH} karakter olmali`);

export const registerRequestSchema = z.object({
  phone: phoneSchema,
  password: passwordSchema,
  fullName: fullNameSchema,
});

export const loginRequestSchema = z.object({
  phone: phoneSchema,
  password: passwordSchema,
});

/** Yenileme jetonu: sunucunun urettigi opak metin; icerigi istemci icin anlamsizdir. */
export const refreshTokenSchema = z.string().trim().min(1, 'zorunlu');

/** POST /v1/auth/refresh: jeton yenisiyle degisir, eskisi bir daha kullanilamaz. */
export const refreshRequestSchema = z.object({ refreshToken: refreshTokenSchema });

/** POST /v1/auth/logout: yenileme jetonu iptal edilir. */
export const logoutRequestSchema = z.object({ refreshToken: refreshTokenSchema });

/**
 * Cikis cevabi. revoked false HATA DEGILDIR: jeton zaten iptal edilmis ya da
 * suresi dolmus olabilir; istemci her iki durumda da yerel oturumu siler.
 */
export const logoutResultSchema = z.object({ revoked: z.boolean() });

export const userProfileSchema = z.object({
  id: idSchema,
  phone: phoneSchema,
  fullName: z.string(),
});

export const authSessionSchema = z.object({
  accessToken: z.string(),
  /** Tek desteklenen tur; istemci basligi "Bearer <token>" olarak kurar. */
  tokenType: z.literal('Bearer').optional(),
  /** Saniye cinsinden omur (JWT_TTL). Bitis ani DEGIL, SURE tasinir. */
  expiresIn: z.number().int().positive(),
  /** Erisim jetonu bitince /v1/auth/refresh'e gonderilir; yalnizca bir kez gecerlidir. */
  refreshToken: z.string(),
  /** Yenileme jetonunun saniye cinsinden omru (REFRESH_TTL). */
  refreshExpiresIn: z.number().int().positive(),
  user: userProfileSchema,
});

export type Phone = z.infer<typeof phoneSchema>;
export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;
export type LogoutRequest = z.infer<typeof logoutRequestSchema>;
export type LogoutResult = z.infer<typeof logoutResultSchema>;
export type UserProfile = z.infer<typeof userProfileSchema>;
export type AuthSession = z.infer<typeof authSessionSchema>;
