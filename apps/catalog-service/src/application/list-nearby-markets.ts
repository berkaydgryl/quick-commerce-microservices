/**
 * Use-case: konuma hizmet veren marketler, yakindan uzaga (ADR-15).
 *
 * Kapsama kurali domain'de (coveringMarkets); depo kapsayanlari verir ve
 * sinir kapsamadan SONRA uygulanir (#175). Kapali marketler listede kalir;
 * bos liste bir hata DEGILDIR ("bolgende market yok").
 *
 * Mesafe YUVARLANMADAN doner: tam sayiya cevirmek proto'nun int32 alanina
 * sigdirmaktir, yani tasima kaygisidir ve interfaces/grpc/mappers.ts'tedir.
 */

import { MARKET_CANDIDATE_LIMIT } from '../config/constants.js';
import type { GeoPoint } from '../domain/geo.js';
import { coveringMarkets } from '../domain/market-coverage.js';
import type { MarketDistance } from '../domain/market-coverage.js';
import type { MarketReader } from '../domain/market-reader.js';

export interface ListNearbyMarketsDeps {
  readonly markets: Pick<MarketReader, 'listCoveringMarkets'>;
}

export type ListNearbyMarkets = (location: GeoPoint) => Promise<readonly MarketDistance[]>;

export function createListNearbyMarkets(deps: ListNearbyMarketsDeps): ListNearbyMarkets {
  // Depo kapsayanlari verir; domain kurali yine son sozdur (bozuk belge, yeni depo).
  return async (location) =>
    coveringMarkets(await deps.markets.listCoveringMarkets(location, MARKET_CANDIDATE_LIMIT));
}
