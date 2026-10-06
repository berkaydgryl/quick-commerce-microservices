/**
 * Uygulama indirme bandi ve tanitim kutulari, ortak tek boy gorsel (T11.7; R1,
 * D18: content.ts'ten tasindi).
 */

import { z } from 'zod';

import { CONTENT_STORE_LINKS_MAX } from '../constants.js';
import { contentImageUrlSchema } from './content-image-url.js';
import { contentTextSchema } from './content-text.js';

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

export type ContentImage = z.infer<typeof contentImageSchema>;

export type StoreLink = z.infer<typeof storeLinkSchema>;

export type AppDownloadContent = z.infer<typeof appDownloadContentSchema>;

export type FeatureContent = z.infer<typeof featureContentSchema>;
