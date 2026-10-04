/**
 * Favori listesinin iyimser guncellemesi (T11.13): kalbe basinca liste
 * sunucuyu beklemeden degisir; hata olursa onceki hali geri yazilir.
 */

import { AppError, ERROR_CODES } from '@getir/core';
import { describe, expect, it } from 'vitest';

import {
  favoriteIdsOf,
  isFavoriteListFull,
  removedFavorite,
  withFavorite,
  withoutFavorite,
} from '../../src/features/favorites/services/favorite-list';

import { NEARBY } from './market-list-test-support';

const [a101, kasap, migros] = NEARBY.map((nearby) => nearby.market);
const at = '2026-10-04T09:00:00.000Z';

describe('favori listesi', () => {
  it('eklenen market EN BASA gelir (en yeni once); liste yokken de calisir', () => {
    if (a101 === undefined || kasap === undefined) throw new Error('test verisi eksik');
    const first = withFavorite(undefined, a101, at);
    const second = withFavorite(first, kasap, at);

    expect(second.items.map((item) => item.market.id)).toEqual([kasap.id, a101.id]);
    expect([...favoriteIdsOf(second)]).toEqual([kasap.id, a101.id]);
  });

  it('zaten favori olan market tekrar eklenmez (eklenme zamani korunur)', () => {
    if (a101 === undefined) throw new Error('test verisi eksik');
    const list = withFavorite(undefined, a101, at);

    expect(withFavorite(list, a101, '2026-10-05T00:00:00.000Z').items).toEqual(list.items);
  });

  it('cikarma yalnizca o marketi siler; favori olmayan market listeyi degistirmez', () => {
    if (a101 === undefined || kasap === undefined || migros === undefined)
      throw new Error('test verisi eksik');
    const list = withFavorite(withFavorite(undefined, a101, at), kasap, at);

    expect(withoutFavorite(list, a101.id).items.map((item) => item.market.id)).toEqual([kasap.id]);
    expect(withoutFavorite(list, migros.id).items).toEqual(list.items);
    expect(favoriteIdsOf(undefined).size).toBe(0);
  });
});

describe('isFavoriteListFull', () => {
  it('yalnizca favoriteMarkets ayrintili VALIDATION_FAILED "liste dolu"dur', () => {
    const full = new AppError(ERROR_CODES.VALIDATION_FAILED, 'dolu', {
      details: { favoriteMarkets: 'en fazla 50 favori işletme olabilir' },
    });
    const otherField = new AppError(ERROR_CODES.VALIDATION_FAILED, 'bicim', {
      details: { marketId: 'mkt_ önekli market kimliği olmalı' },
    });

    expect(isFavoriteListFull(full)).toBe(true);
    expect(isFavoriteListFull(otherField)).toBe(false);
    expect(isFavoriteListFull(new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'yogun'))).toBe(false);
    expect(isFavoriteListFull(new Error('ag'))).toBe(false);
  });
});

describe('removedFavorite (QA W2: odak ve duyuru)', () => {
  it('tek cikis: kimligi ve eski sirasi (bas, orta, son)', () => {
    expect(removedFavorite(['a', 'b', 'c'], ['b', 'c'])).toEqual({ marketId: 'a', index: 0 });
    expect(removedFavorite(['a', 'b', 'c'], ['a', 'c'])).toEqual({ marketId: 'b', index: 1 });
    expect(removedFavorite(['a', 'b', 'c'], ['a', 'b'])).toEqual({ marketId: 'c', index: 2 });
    expect(removedFavorite(['a'], [])).toEqual({ marketId: 'a', index: 0 });
  });

  it('baska degisiklikte undefined: ekleme, iki cikis, sira degisimi, ayni liste', () => {
    expect(removedFavorite(['a'], ['b', 'a'])).toBeUndefined();
    expect(removedFavorite(['a', 'b', 'c'], ['c'])).toBeUndefined();
    expect(removedFavorite(['a', 'b', 'c'], ['c', 'b'])).toBeUndefined();
    expect(removedFavorite(['a', 'b'], ['a', 'b'])).toBeUndefined();
  });
});
