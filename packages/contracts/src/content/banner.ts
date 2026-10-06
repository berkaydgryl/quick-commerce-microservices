/**
 * Karsilama banner'i (T11.6; R1, D18: content.ts'ten tasindi).
 */

import { z } from 'zod';

import { CONTENT_BANNER_SOURCES_MAX } from '../constants.js';
import { contentImageUrlSchema } from './content-image-url.js';

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

export type BannerSource = z.infer<typeof bannerSourceSchema>;

export type Banner = z.infer<typeof bannerSchema>;
