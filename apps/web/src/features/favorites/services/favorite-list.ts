/**
 * Favori listesinin iyimser guncellemesi (T11.13; roadmap MVP deseni #4):
 * kalbe basinca liste sunucu cevabini beklemeden degisir, hata olursa onceki
 * hali geri yazilir. Saf fonksiyonlar: test edilir, React bilmez.
 */

import type { FavoriteMarket, FavoriteMarketList, Market } from '@getir/contracts';
import { ERROR_CODES } from '@getir/core';

import { hasErrorCode } from '../../../shared/api/error-code';

/** Listedeki market kimlikleri (kartlar kalbin dolu olup olmadigini buradan sorar). */
export function favoriteIdsOf(list: FavoriteMarketList | undefined): ReadonlySet<string> {
  return new Set(list?.items.map((item) => item.market.id) ?? []);
}

/** Market en basa eklenir (en yeni once); zaten favoriyse liste degismez. */
export function withFavorite(
  list: FavoriteMarketList | undefined,
  market: Market,
  addedAt: string,
): FavoriteMarketList {
  const items = list?.items ?? [];
  if (items.some((item) => item.market.id === market.id)) {
    return { items };
  }
  return { items: [{ market, addedAt }, ...items] };
}

/** Bir marketin listedeki hali: oge ve sirasi; favori degilse undefined. */
export interface FavoriteSnapshot {
  readonly item: FavoriteMarket;
  readonly index: number;
}

/** Marketin tiklamadan onceki hali (geri alma icin; QA W1). */
export function snapshotFavorite(
  list: FavoriteMarketList | undefined,
  marketId: string,
): FavoriteSnapshot | undefined {
  const index = list?.items.findIndex((item) => item.market.id === marketId) ?? -1;
  const item = index === -1 ? undefined : list?.items[index];
  return item === undefined ? undefined : { item, index };
}

/**
 * Geri alma YALNIZCA o marketin ogesine: once listedeki hali cikar, onceden
 * favoriyse eski sirasina geri konur. Butun listeyi eski haline yazmak, araya
 * giren baska kartin iyimser degisikligini silerdi (QA W1).
 */
export function restoreFavorite(
  list: FavoriteMarketList | undefined,
  marketId: string,
  previous: FavoriteSnapshot | undefined,
): FavoriteMarketList {
  const items = (list?.items ?? []).filter((item) => item.market.id !== marketId);
  if (previous === undefined) {
    return { items };
  }
  const index = Math.min(previous.index, items.length);
  return { items: [...items.slice(0, index), previous.item, ...items.slice(index)] };
}

/** Market listeden cikar; favori degilse liste degismez. */
export function withoutFavorite(
  list: FavoriteMarketList | undefined,
  marketId: string,
): FavoriteMarketList {
  return { items: (list?.items ?? []).filter((item) => item.market.id !== marketId) };
}

/**
 * Sunucunun "liste dolu" cevabi mi (VALIDATION_FAILED, ayrinti favoriteMarkets
 * alaninda)? Bildirim sebebi soyler; diger hatalar genel bildirimle.
 */
export function isFavoriteListFull(error: unknown): boolean {
  if (!hasErrorCode(error, ERROR_CODES.VALIDATION_FAILED)) {
    return false;
  }
  const { details } = error;
  return typeof details === 'object' && details !== null && 'favoriteMarkets' in details;
}

/** Listeden cikan tek oge: kimligi ve eski sirasi. */
export interface RemovedFavorite {
  readonly marketId: string;
  readonly index: number;
}

/**
 * Onceki ve yeni kimlik listesine gore TEK bir oge cikti mi (favori sayfasinda
 * kalbe basildi; QA W2)? Kalan ogelerin sirasi ayniysa cikanin kimligi ve
 * eski sirasi doner; baska degisiklikte (ekleme, birden fazla cikis, ilk
 * yukleme) undefined: odak tasinmaz, duyuru yapilmaz.
 */
export function removedFavorite(
  previous: readonly string[],
  next: readonly string[],
): RemovedFavorite | undefined {
  if (previous.length !== next.length + 1) {
    return undefined;
  }
  const index = previous.findIndex((id, position) => id !== next[position]);
  const removedAt = index === -1 ? previous.length - 1 : index;
  const rest = previous.filter((_, position) => position !== removedAt);
  const marketId = previous[removedAt];
  return marketId !== undefined && rest.every((id, position) => id === next[position])
    ? { marketId, index: removedAt }
    : undefined;
}
