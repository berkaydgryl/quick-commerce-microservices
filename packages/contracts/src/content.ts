/**
 * Icerik uclarinin semalari (T11.6).
 *
 * Karsilama ekraninin butun metinleri ve gorselleri bu sozlesmeden gecer:
 * web kodunda ekran metni sabit yazilmaz. Bugun kaynak gateway'e gomulu
 * dosyadir (internal/content/welcome.json); bir CMS baglaninca uc ve bu sema
 * degismez, yalnizca kaynak degisir.
 *
 * Form KURALLARI ve hata cumleleri burada degildir: onlar auth.ts'teki
 * semalardan gelir, cunku gateway ayni kurali ayni cumleyle uygular. Buradaki
 * metinler yalnizca etiket, baslik ve dugme yazisidir.
 */

import { z } from 'zod';

import {
  CONTENT_BANNER_SOURCES_MAX,
  CONTENT_FEATURES_MAX,
  CONTENT_PHONE_COUNTRIES_MAX,
  CONTENT_STORE_LINKS_MAX,
  CONTENT_TEXT_MAX_LENGTH,
  COUNTRY_CODE_PATTERN,
  DIAL_CODE_PATTERN,
} from './constants.js';

/** Ekranda gorunen bir metin; bos olamaz. */
const contentTextSchema = z.string().min(1).max(CONTENT_TEXT_MAX_LENGTH);

/** Mutlak gorsel adresi; veri goreli yol saklar, gateway ASSET_BASE_URL ile kurar. */
const contentImageUrlSchema = z.string().url();

/** Banner'in bir boyu. */
export const bannerSourceSchema = z.object({
  url: contentImageUrlSchema,
  /** Dosyanin piksel genisligi: tarayici srcset'ten ekrana uygun boyu secer. */
  width: z.number().int().positive(),
});

/**
 * Karsilama banner'i: ayni gorselin boylari ve dogal boyutu. Boyut, oran icin
 * gelir: tarayici yeri onceden ayirir, gorsel inince sayfa ziplamaz. Ayni
 * genislik iki kez yazilamaz (srcset'te gecersiz olur).
 */
export const bannerSchema = z.object({
  sources: z
    .array(bannerSourceSchema)
    .min(1)
    .max(CONTENT_BANNER_SOURCES_MAX)
    .refine((sources) => new Set(sources.map((source) => source.width)).size === sources.length, {
      message: 'ayni genislik iki kez yazilamaz',
    }),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

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
 * Karsilama karti (telefon + "Devam Et") ile giris ve kayit penceresinin
 * metinleri. Gelistirmeye ozel demo hesap listesinin metni burada YOKTUR: o
 * arac production paketine hic girmez.
 */
export const loginCardContentSchema = z.object({
  title: contentTextSchema,
  /** Ulke kodu secicisinin erisilebilir adi. */
  countryLabel: contentTextSchema,
  phoneLabel: contentTextSchema,
  phonePlaceholder: contentTextSchema,
  continueLabel: contentTextSchema,
  /** Giris ve kayit penceresinin kapat (X) dugmesinin erisilebilir adi. */
  closeLabel: contentTextSchema,
  /** Sifre alanindaki goster/gizle dugmesinin erisilebilir adi (aria-pressed ile). */
  showPasswordLabel: contentTextSchema,
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
  login: loginStepContentSchema,
  register: registerStepContentSchema,
});

/** Tek boy bir gorsel: adres ve dogal boyut (yer onceden ayrilir, sayfa ziplamaz). */
export const contentImageSchema = z.object({
  url: contentImageUrlSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

/**
 * Magaza rozeti (T11.7): baglanti yeni sekmede magaza sayfasini acar. Adres
 * yalnizca https olabilir (disari giden baglanti; gateway kurmaz, oldugu gibi
 * tasir).
 */
export const storeLinkSchema = z.object({
  /** Baglantinin erisilebilir adi ve rozetin alt metni: "App Store'dan indir". */
  label: contentTextSchema,
  url: z.string().url().startsWith('https://'),
  badge: contentImageSchema,
});

/** Uygulama indirme bandi (T11.7): solda baslik, alt metin ve rozetler; sagda telefon gorseli. */
export const appDownloadContentSchema = z.object({
  title: contentTextSchema,
  subtitle: contentTextSchema,
  /** Susleme: anlam metindedir, alt metni bostur. */
  image: contentImageSchema,
  stores: z.array(storeLinkSchema).min(1).max(CONTENT_STORE_LINKS_MAX),
});

/** Tanitim kutusu (T11.7): gorsel (susleme) + metin. */
export const featureContentSchema = z.object({
  image: contentImageSchema,
  text: contentTextSchema,
});

/** GET /v1/content/welcome - oturumsuz ziyaretcinin karsilama ekrani. */
export const welcomeContentSchema = z.object({
  header: z.object({
    /** Logonun iki parcasi: "getir" + "market". */
    brand: contentTextSchema,
    service: contentTextSchema,
    loginLabel: contentTextSchema,
    registerLabel: contentTextSchema,
  }),
  hero: z.object({
    /** Sayfanin h1'i ve banner'in alt metni: slogan gorselin icinde yazilidir. */
    title: contentTextSchema,
    banner: bannerSchema,
  }),
  loginCard: loginCardContentSchema,
  categories: z.object({
    title: contentTextSchema,
  }),
  appDownload: appDownloadContentSchema,
  features: z.array(featureContentSchema).min(1).max(CONTENT_FEATURES_MAX),
});

export type BannerSource = z.infer<typeof bannerSourceSchema>;
export type Banner = z.infer<typeof bannerSchema>;
export type PhoneCountry = z.infer<typeof phoneCountrySchema>;
export type LoginStepContent = z.infer<typeof loginStepContentSchema>;
export type RegisterStepContent = z.infer<typeof registerStepContentSchema>;
export type LoginCardContent = z.infer<typeof loginCardContentSchema>;
export type ContentImage = z.infer<typeof contentImageSchema>;
export type StoreLink = z.infer<typeof storeLinkSchema>;
export type AppDownloadContent = z.infer<typeof appDownloadContentSchema>;
export type FeatureContent = z.infer<typeof featureContentSchema>;
export type WelcomeContent = z.infer<typeof welcomeContentSchema>;
