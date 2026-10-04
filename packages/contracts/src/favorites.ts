/**
 * Favori marketler (T11.13): GET /v1/me/favorites, PUT ve DELETE
 * /v1/me/favorites/{marketId}. Kayit gateway'de (kullanici belgesi); market
 * bilgisi katalogdan tek cagriyla gelir. Ekleme ve cikarma idempotenttir.
 */

import { z } from 'zod';

import { marketSchema } from './catalog.js';
import { isoDateTimeSchema, marketIdSchema } from './common.js';
import { FAVORITE_MARKETS_MAX } from './constants.js';

/** Favori listesinin satiri: market ve eklenme zamani. */
export const favoriteMarketSchema = z.object({
  market: marketSchema,
  addedAt: isoDateTimeSchema,
});

/** GET /v1/me/favorites: en yeni favori once; katalogdan kalkmis market listede yok. */
export const favoriteMarketListSchema = z.object({
  items: z.array(favoriteMarketSchema).max(FAVORITE_MARKETS_MAX),
});

/** PUT ve DELETE cevabi: marketin son durumu. */
export const favoriteStatusSchema = z.object({
  marketId: marketIdSchema,
  isFavorite: z.boolean(),
});

export type FavoriteMarket = z.infer<typeof favoriteMarketSchema>;
export type FavoriteMarketList = z.infer<typeof favoriteMarketListSchema>;
export type FavoriteStatus = z.infer<typeof favoriteStatusSchema>;
