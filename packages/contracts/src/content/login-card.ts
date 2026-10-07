/**
 * Karsilama karti ile giris, kayit ve sifre yenileme pencereleri (T11.6, T11.7,
 * T11.9; R1, D18: content.ts'ten tasindi).
 */

import { z } from 'zod';

import {
  CONTENT_PHONE_COUNTRIES_MAX,
  COUNTRY_CODE_PATTERN,
  DIAL_CODE_PATTERN,
} from '../constants.js';
import { contentImageUrlSchema } from './content-image-url.js';
import { contentTextSchema } from './content-text.js';

/**
 * Ulke kodu secicisinin bir satiri. Telefon kurali (PHONE_PATTERN) bugun
 * yalnizca +90 kabul eder; listedeki baska bir kod formda reddedilir.
 */
export const phoneCountrySchema = z.object({
  /** ISO 3166-1 alfa-2: "TR". */
  code: z.string().regex(COUNTRY_CODE_PATTERN),
  name: contentTextSchema,
  /** "+90". */
  dialCode: z.string().regex(DIAL_CODE_PATTERN),
  flagUrl: contentImageUrlSchema,
});

/** Giris penceresi: telefon + sifre (kayitli kullanici). */
export const loginStepContentSchema = z.object({
  passwordLabel: contentTextSchema,
  submitLabel: contentTextSchema,
  /** Istek surerken dugmede gorunen metin. */
  pendingLabel: contentTextSchema,
  /** "Hesabin yok mu?" + kayit penceresine gecen baglanti. */
  registerPrompt: contentTextSchema,
  registerLinkLabel: contentTextSchema,
  /** Kayitsiz numara yazilinca telefonun altinda (T11.7): "hesap yok" + kayit baglantisi. */
  unknownPhoneNotice: contentTextSchema,
});

/** Kayit penceresi: ad soyad, telefon ve sifre. */
export const registerStepContentSchema = z.object({
  fullNameLabel: contentTextSchema,
  passwordLabel: contentTextSchema,
  submitLabel: contentTextSchema,
  pendingLabel: contentTextSchema,
  /** "Zaten hesabin var mi?" + giris penceresine donen baglanti. */
  loginPrompt: contentTextSchema,
  loginLinkLabel: contentTextSchema,
  /** Kayitli numara yazilinca telefonun altinda (T11.7): "hesap var" + giris baglantisi. */
  knownPhoneNotice: contentTextSchema,
});

/**
 * Sifre yenileme penceresi (T11.9; "Sifremi unuttum"): telefon ve yeni sifre.
 * Kayitsiz numara uyarisi giris adimininkiyle aynidir (login.unknownPhoneNotice).
 */
export const resetPasswordStepContentSchema = z.object({
  title: contentTextSchema,
  /** Basligin altindaki kisa aciklama. */
  description: contentTextSchema,
  passwordLabel: contentTextSchema,
  submitLabel: contentTextSchema,
  pendingLabel: contentTextSchema,
  /** "Sifreni hatirladin mi?" + giris penceresine donen baglanti. */
  loginPrompt: contentTextSchema,
  loginLinkLabel: contentTextSchema,
});

/**
 * Karsilama karti (telefon + "Devam Et") ile giris ve kayit penceresinin
 * metinleri. Gelistirmeye ozel demo hesap listesinin metni burada YOKTUR: o
 * arac production paketine hic girmez.
 */
export const loginCardContentSchema = z.object({
  title: contentTextSchema,
  /** Ulke kodu secicisinin erisilebilir adi. */
  countryLabel: contentTextSchema,
  /**
   * Telefon alaninin etiketi: bos alanda kutunun icinde, deger girilince uste
   * kayar ("Telefon Numarası"; T11.16'dan beri ipucu "5XX ..." yok).
   */
  phoneLabel: contentTextSchema,
  continueLabel: contentTextSchema,
  /** Giris ve kayit penceresinin kapat (X) dugmesinin erisilebilir adi. */
  closeLabel: contentTextSchema,
  /**
   * Sifre alanindaki goz dugmesinin erisilebilir adi, duruma gore: sifre
   * gizliyken "Şifreyi göster", gorunurken "Şifreyi gizle" (T11.16 duzeltmesi).
   */
  showPasswordLabel: contentTextSchema,
  hidePasswordLabel: contentTextSchema,
  countries: z
    .array(phoneCountrySchema)
    .min(1)
    .max(CONTENT_PHONE_COUNTRIES_MAX)
    .refine(
      (countries) => new Set(countries.map((country) => country.code)).size === countries.length,
      {
        message: 'ayni ulke iki kez yazilamaz',
      },
    ),
  /** Karttaki ve giris penceresindeki "Sifremi unuttum" baglantisi (T11.9). */
  forgotPasswordLabel: contentTextSchema,
  login: loginStepContentSchema,
  register: registerStepContentSchema,
  resetPassword: resetPasswordStepContentSchema,
});

export type PhoneCountry = z.infer<typeof phoneCountrySchema>;

export type LoginStepContent = z.infer<typeof loginStepContentSchema>;

export type RegisterStepContent = z.infer<typeof registerStepContentSchema>;

export type ResetPasswordStepContent = z.infer<typeof resetPasswordStepContentSchema>;

export type LoginCardContent = z.infer<typeof loginCardContentSchema>;
