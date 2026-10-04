/**
 * Use-case: verilen marketleri toplu okur (T11.13). Favori isletmeler
 * sayfasinin kaynagidir: butun favorilerin kartlari TEK sorguda gelir (N+1 yok).
 *
 * Kurallar:
 *  - Katalogda olmayan kimlik sessizce ATLANMAZ, `missing`'e duser: cagiran
 *    (gateway) kaldirilmis marketi bilir.
 *  - Tekrarlanan kimlik tek sayilir; cevap istek sirasini korur (favori
 *    sayfasi en yeni favoriden eskiye sirayla ister).
 *  - Kapali market de doner: acik/kapali bilgisi kartin kendisindedir.
 */

import type { Market } from '../domain/catalog.js';
import type { MarketReader } from '../domain/market-reader.js';

export interface BatchGetMarketsDeps {
  readonly markets: Pick<MarketReader, 'findMarketsByIds'>;
}

export interface BatchGetMarketsResult {
  /** Bulunan marketler, istek sirasinda. */
  readonly markets: readonly Market[];
  /** Katalogda olmayan kimlikler, istek sirasinda. */
  readonly missing: readonly string[];
}

export type BatchGetMarkets = (marketIds: readonly string[]) => Promise<BatchGetMarketsResult>;

export function createBatchGetMarkets(deps: BatchGetMarketsDeps): BatchGetMarkets {
  return async (marketIds) => {
    const unique = [...new Set(marketIds)];
    const found = new Map(
      (await deps.markets.findMarketsByIds(unique)).map((market) => [market.id, market]),
    );

    return {
      markets: unique.flatMap((id) => {
        const market = found.get(id);
        return market === undefined ? [] : [market];
      }),
      missing: unique.filter((id) => !found.has(id)),
    };
  };
}
