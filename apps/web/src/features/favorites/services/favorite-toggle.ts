/**
 * Kalbe basmanin mutasyon ayarlari (T11.13; roadmap MVP deseni #4; QA W1).
 * Hook'tan ayri: bagimliliklar disaridan verilir, birim testi sahte sunucuyla
 * MutationObserver uzerinden sinar.
 *
 *  - IYIMSER: liste hemen degisir (onMutate ag istegi kuyruga girmeden calisir).
 *  - SIRA: ayni marketin tiklamalari ayni kapsamdadir (scope); istekler sirayla
 *    gider, hizli cift tikta son niyet kazanir. Kapsam olmasaydi PUT ve DELETE
 *    birlikte ucar, sunucuya ters sirayla varirsa son durum niyetin tersi olurdu.
 *  - GERI ALMA yalnizca o marketin ogesine; diger kartlarin iyimser hali kalir.
 *  - YENIDEN OKUMA favori mutasyonlarinin HEPSI bitince, tam bir kez: araya
 *    giren okuma henuz bitmemis tiklamanin iyimser halini ezerdi.
 */

import type { FavoriteMarketList, FavoritesContent, Market } from '@getir/contracts';
import type { MutationOptions, QueryClient } from '@tanstack/react-query';

import { favoriteKeys } from '../api/query-keys';

import type { FavoriteSnapshot } from './favorite-list';
import {
  isFavoriteListFull,
  restoreFavorite,
  snapshotFavorite,
  withFavorite,
  withoutFavorite,
} from './favorite-list';

/** Butun favori mutasyonlarinin anahtari: "hepsi bitti mi" sorusu bununla sayilir. */
export const FAVORITE_MUTATION_KEY = ['favorites', 'toggle'] as const;

export interface FavoriteToggleDeps {
  readonly queryClient: QueryClient;
  readonly userId: string | null;
  readonly market: Market;
  /** Bildirim metinleri (icerikten). */
  readonly texts: Pick<FavoritesContent, 'updateFailedToast' | 'listFullToast'>;
  readonly notify: (message: string) => void;
  /** Sunucu cagrilari (uygulamada yetkili istemci, tiklama basina yeni Idempotency-Key). */
  readonly add: (marketId: string) => Promise<unknown>;
  readonly remove: (marketId: string) => Promise<unknown>;
  /** Iyimser ogenin eklenme zamani (ISO 8601). */
  readonly now: () => string;
}

/** Istemci basina bekleyen "hepsi bitti mi" denetimi (ayni turda bitenler paylasir). */
const pendingIdleChecks = new WeakSet<QueryClient>();

/**
 * Favori mutasyonlarinin hepsi bitince listeyi BIR KEZ yeniden okur
 * (B-T11.13-1). Denetim onSettled'da yapilamaz: mutasyon onSettled bitene kadar
 * "suruyor" sayilir; ayni turda biten iki mutasyon birbirini gorur ve ikisi de
 * okumayi atlardi. Denetim bir sonraki tura (makro gorev) atilir; o turda
 * butun bitenler sonuclanmistir. Ayni turdaki istekler tek denetimde birlesir:
 * okuma iki kez gitmez. Hala suren mutasyon varsa okuma onun bitisine kalir.
 */
function invalidateWhenIdle(queryClient: QueryClient): void {
  if (pendingIdleChecks.has(queryClient)) {
    return;
  }
  pendingIdleChecks.add(queryClient);
  setTimeout(() => {
    pendingIdleChecks.delete(queryClient);
    if (queryClient.isMutating({ mutationKey: FAVORITE_MUTATION_KEY }) === 0) {
      void queryClient.invalidateQueries({ queryKey: favoriteKeys.all });
    }
  }, 0);
}

interface FavoriteToggleContext {
  readonly previous: FavoriteSnapshot | undefined;
}

/** Degisken: istenen son durum (true favoriye ekle, false cikar). */
export function favoriteToggleOptions(
  deps: FavoriteToggleDeps,
): MutationOptions<unknown, Error, boolean, FavoriteToggleContext> {
  const key = favoriteKeys.list(deps.userId);
  const marketId = deps.market.id;

  return {
    mutationKey: FAVORITE_MUTATION_KEY,
    scope: { id: `favorite:${marketId}` },
    mutationFn: (favorite) => (favorite ? deps.add(marketId) : deps.remove(marketId)),
    onMutate: async (favorite) => {
      await deps.queryClient.cancelQueries({ queryKey: key });
      const previous = snapshotFavorite(
        deps.queryClient.getQueryData<FavoriteMarketList>(key),
        marketId,
      );
      deps.queryClient.setQueryData<FavoriteMarketList>(key, (list) =>
        favorite ? withFavorite(list, deps.market, deps.now()) : withoutFavorite(list, marketId),
      );
      return { previous };
    },
    onError: (error, _favorite, context) => {
      deps.queryClient.setQueryData<FavoriteMarketList>(key, (list) =>
        restoreFavorite(list, marketId, context?.previous),
      );
      deps.notify(
        isFavoriteListFull(error) ? deps.texts.listFullToast : deps.texts.updateFailedToast,
      );
    },
    onSettled: () => invalidateWhenIdle(deps.queryClient),
  };
}
