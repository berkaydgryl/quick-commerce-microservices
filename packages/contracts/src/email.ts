/**
 * E-posta dogrulama (T11.14):
 *   POST /v1/me/email/code    adrese 6 haneli kod gonderir
 *   POST /v1/me/email/verify  kodu dogrular, adresi hesaba yazar
 *
 * E-posta KIMLIK DEGILDIR (ADR-12 eki): giris telefon + sifreyle kalir, kayit
 * formu e-posta almaz. Hesaba yalnizca DOGRULANMIS adres yazilir; dogrulanmamis
 * adres yalnizca bekleyen kodun yaninda, Redis'te 10 dakika durur. Ayni adres
 * iki hesapta dogrulanamaz (users.email benzersiz).
 *
 * Kurallar (kullanicinin karari A2): kod 6 rakam, VERIFICATION_CODE_TTL_SECONDS
 * gecerli, VERIFICATION_CODE_MAX_ATTEMPTS yanlista iptal, yeni kod en erken
 * VERIFICATION_CODE_RESEND_SECONDS sonra. Yeni kod oncekini gecersiz kilar.
 *
 * Hatalar yeni kod getirmez: kural ihlali alanin altinda gosterilen
 * VALIDATION_FAILED'dir (email ya da code; adres defterindeki "ayni ad" gibi),
 * erken yeniden gonderme RATE_LIMITED + retryAfterSeconds'tir. Sunucunun
 * bildigi cumleler (adres baska hesapta, kod hatali, sure doldu) burada degil
 * gateway'dedir; burada yalnizca formun da uyguladigi bicim kurallari durur.
 */

import { z } from 'zod';

import { EMAIL_MAX_LENGTH, EMAIL_PATTERN } from './constants.js';
import { verificationCodeSchema } from './verification.js';

/** Bicim kuralinin cumlesi: sunucu (gateway) ve form ayni cumleyi gosterir. */
export const EMAIL_MESSAGE = 'Geçerli bir e-posta adresi gir (örnek ad@ornek.com)';

/** Uzunluk kuralinin cumlesi. */
export const EMAIL_MAX_MESSAGE = `en fazla ${EMAIL_MAX_LENGTH} karakter olmalı`;

/**
 * E-posta: bosluklari kirpilir ve kucuk harfe cevrilir. Benzersizlik bu bicim
 * uzerindedir: "Ad@Ornek.com" ile "ad@ornek.com" iki hesapta dogrulanamaz.
 * Siralama onemlidir: once kirpma ve kucuk harf, sonra kurallar.
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(EMAIL_MAX_LENGTH, EMAIL_MAX_MESSAGE)
  .regex(EMAIL_PATTERN, EMAIL_MESSAGE);

/** POST /v1/me/email/code govdesi. */
export const sendEmailCodeRequestSchema = z.object({
  email: emailSchema,
});

/**
 * POST /v1/me/email/code cevabi (202): kodun gonderildigi adres (kucuk harfli
 * bicim), kalan gecerlilik ve yeni kod icin bekleme. Sureler saniyedir; istemci
 * geri sayimi cevabi aldigi andan baslatir.
 */
export const emailCodeSentSchema = z.object({
  email: emailSchema,
  expiresInSeconds: z.number().int().positive(),
  resendAfterSeconds: z.number().int().nonnegative(),
});

/**
 * POST /v1/me/email/verify govdesi. Adres de gonderilir: baska bir sekmede
 * yeni adrese kod istenmisse eski pencerenin kodu yanlis adresi dogrulamasin
 * (bekleyen adresle eslesmeyen istek "suresi doldu" sayilir). Cevap guncel
 * profildir (userProfileSchema; email dolu).
 */
export const verifyEmailRequestSchema = z.object({
  email: emailSchema,
  code: verificationCodeSchema,
});

export type Email = z.infer<typeof emailSchema>;
export type SendEmailCodeRequest = z.infer<typeof sendEmailCodeRequestSchema>;
export type EmailCodeSent = z.infer<typeof emailCodeSentSchema>;
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;
