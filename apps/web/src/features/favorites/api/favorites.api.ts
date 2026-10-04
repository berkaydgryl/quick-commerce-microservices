/**
 * Favori marketler (T11.13): GET /v1/me/favorites, PUT ve DELETE
 * /v1/me/favorites/{marketId}. Uclarin hepsi korumali: yetkili istemciyle
 * cagrilir. Ekleme ve cikarma kalici kayittir: anahtar ister (ADR-08).
 */

import { favoriteMarketListSchema, favoriteStatusSchema } from '@getir/contracts';
import type { FavoriteMarketList, FavoriteStatus } from '@getir/contracts';

import type { HttpClient } from '../../../shared/api/http-client';

const favoritePath = (marketId: string) => `/v1/me/favorites/${encodeURIComponent(marketId)}`;

/** En yeni favori once; favorisi olmayan hesapta bos liste (hata degil). */
export function fetchFavorites(
  client: HttpClient,
  signal?: AbortSignal,
): Promise<FavoriteMarketList> {
  return client.request('/v1/me/favorites', { schema: favoriteMarketListSchema, signal });
}

/** Market favori olur (idempotent). Market yoksa NOT_FOUND, liste doluysa VALIDATION_FAILED. */
export function addFavorite(
  client: HttpClient,
  marketId: string,
  idempotencyKey: string,
): Promise<FavoriteStatus> {
  return client.request(favoritePath(marketId), {
    method: 'PUT',
    idempotencyKey,
    schema: favoriteStatusSchema,
  });
}

/** Market favoriden cikar (idempotent: favori degilse de basarili). */
export function removeFavorite(
  client: HttpClient,
  marketId: string,
  idempotencyKey: string,
): Promise<FavoriteStatus> {
  return client.request(favoritePath(marketId), {
    method: 'DELETE',
    idempotencyKey,
    schema: favoriteStatusSchema,
  });
}
