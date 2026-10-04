/**
 * Kalbe basmanin kurallari (T11.13; QA W1, W7): iyimser guncelleme, o
 * marketin ogesine geri alma, bildirim, market basina sira (hizli cift tikta
 * son niyet) ve kartlarin birbirini ezmemesi. Mutasyon ayarlari gercek
 * TanStack MutationObserver'la, sahte sunucuya karsi kosar.
 */

import { CONTENT_FALLBACK } from '@getir/contracts';
import type { FavoriteMarketList, Market } from '@getir/contracts';
import { AppError, ERROR_CODES } from '@getir/core';
import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { favoriteKeys } from '../../src/features/favorites/api/query-keys';
import { favoriteToggleOptions } from '../../src/features/favorites/services/favorite-toggle';

import { NEARBY } from './market-list-test-support';

const USER = 'usr_0123456789abcdef0123456789abcdef';
const KEY = favoriteKeys.list(USER);
const AT = '2026-10-04T09:00:00.000Z';
const TEXTS = CONTENT_FALLBACK.favorites;
const [A101, KASAP] = NEARBY.map((nearby) => nearby.market) as [Market, Market];

interface ServerOptions {
  readonly addDelayMs?: number;
  readonly removeDelayMs?: number;
  readonly failAdd?: (marketId: string) => Error | undefined;
}

/** Sahte sunucu: cagrilari kaydeder, favorileri tutar; gecikme ve hata verilebilir. */
function fakeServer({ addDelayMs = 0, removeDelayMs = 0, failAdd }: ServerOptions = {}) {
  const favorites = new Set<string>();
  const log: string[] = [];
  const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  return {
    favorites,
    log,
    add: async (marketId: string) => {
      await later(addDelayMs);
      const error = failAdd?.(marketId);
      if (error !== undefined) throw error;
      favorites.add(marketId);
      log.push(`add:${marketId}`);
    },
    remove: async (marketId: string) => {
      await later(removeDelayMs);
      favorites.delete(marketId);
      log.push(`remove:${marketId}`);
    },
  };
}

function setup(server: ReturnType<typeof fakeServer>, initial: FavoriteMarketList = { items: [] }) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(KEY, initial);
  const toasts: string[] = [];
  const card = (market: Market) =>
    new MutationObserver(
      queryClient,
      favoriteToggleOptions({
        queryClient,
        userId: USER,
        market,
        texts: TEXTS,
        notify: (message) => toasts.push(message),
        add: server.add,
        remove: server.remove,
        now: () => AT,
      }),
    );
  const ids = () =>
    (queryClient.getQueryData<FavoriteMarketList>(KEY)?.items ?? []).map((item) => item.market.id);
  return { queryClient, toasts, card, ids };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = (promise: Promise<unknown>) => promise.catch(() => undefined);

describe('favoriteToggleOptions', () => {
  it('iyimser: istek bitmeden liste degisir; basarida kalir', async () => {
    const server = fakeServer({ addDelayMs: 20 });
    const { card, ids } = setup(server);

    const done = card(A101).mutate(true);
    await tick();
    expect(ids()).toEqual([A101.id]);

    await done;
    expect(ids()).toEqual([A101.id]);
    expect([...server.favorites]).toEqual([A101.id]);
  });

  it('hata: o marketin ogesi geri alinir, genel bildirim cikar', async () => {
    const server = fakeServer({
      failAdd: () => new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'Servis şu an yoğun'),
    });
    const { card, ids, toasts } = setup(server);

    await settle(card(A101).mutate(true));

    expect(ids()).toEqual([]);
    expect(toasts).toEqual([TEXTS.updateFailedToast]);
  });

  it('liste dolu: sebebini soyleyen bildirim', async () => {
    const server = fakeServer({
      failAdd: () =>
        new AppError(ERROR_CODES.VALIDATION_FAILED, 'dolu', {
          details: { favoriteMarkets: 'en fazla 50 favori işletme olabilir' },
        }),
    });
    const { card, toasts } = setup(server);

    await settle(card(A101).mutate(true));

    expect(toasts).toEqual([TEXTS.listFullToast]);
  });

  it('hizli cift tik (QA W1): istekler sirayla gider, son niyet kazanir', async () => {
    // Ekleme yavas, cikarma hizli: sira olmasaydi cikarma once biter, ekleme
    // sonra gelir ve market niyetin tersine favori kalirdi.
    const server = fakeServer({ addDelayMs: 30, removeDelayMs: 0 });
    const { card, ids } = setup(server);
    const heart = card(A101);

    const first = heart.mutate(true);
    const second = heart.mutate(false);
    await tick();
    expect(ids()).toEqual([]);

    await Promise.all([first, second]);
    expect(server.log).toEqual([`add:${A101.id}`, `remove:${A101.id}`]);
    expect([...server.favorites]).toEqual([]);
    expect(ids()).toEqual([]);
  });

  it('iki kart birbirini ezmez: birinin geri almasi digerinin iyimser halini silmez', async () => {
    const server = fakeServer({
      addDelayMs: 10,
      failAdd: (marketId) =>
        marketId === A101.id ? new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'yogun') : undefined,
    });
    const { card, ids, queryClient } = setup(server);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await Promise.all([settle(card(A101).mutate(true)), card(KASAP).mutate(true)]);

    expect(ids()).toEqual([KASAP.id]);
    expect([...server.favorites]).toEqual([KASAP.id]);
    // Yeniden okuma bir kez: favori mutasyonlarinin hepsi bitince (bir sonraki turda).
    await tick();
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('geri alinan oge eski sirasina doner (cikarma hatasi)', async () => {
    const server = fakeServer();
    server.remove = () => Promise.reject(new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'yogun'));
    const initial: FavoriteMarketList = {
      items: [
        { market: KASAP, addedAt: AT },
        { market: A101, addedAt: AT },
      ],
    };
    const { card, ids } = setup(server, initial);

    await settle(card(KASAP).mutate(false));

    expect(ids()).toEqual([KASAP.id, A101.id]);
  });

  it('iki marketin istegi AYNI turda biterse yeniden okuma yine tam bir kez (B-T11.13-1)', async () => {
    // Iki ekleme ayni sozu bekler: serbest birakilinca ikisi de ayni mikro gorev
    // turunda biter ve onSettled'da birbirini "hala suruyor" gorur.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const server = fakeServer();
    server.add = async (marketId: string) => {
      await gate;
      server.favorites.add(marketId);
    };
    const { card, queryClient, ids } = setup(server);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const both = Promise.all([card(A101).mutate(true), card(KASAP).mutate(true)]);
    await tick();
    release();
    await both;
    await tick();

    expect(ids()).toEqual([KASAP.id, A101.id]);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});
