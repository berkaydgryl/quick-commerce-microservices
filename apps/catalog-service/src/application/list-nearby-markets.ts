/**
 * Use-case: konuma hizmet veren marketler, yakindan uzaga (ADR-15).
 *
 * Kapsama kurali domain'de (coveringMarkets). Kapali marketler listede kalir;
 * bos liste bir hata DEGILDIR ("bolgende market yok").
 */

import { MARKET_CANDIDATE_LIMIT } from '../config/constants.js';
import type { Market } from '../domain/catalog.js';
import type { GeoPoint } from '../domain/geo.js';
import { coveringMarkets } from '../domain/market-coverage.js';
import type { MarketReader } from '../domain/market-reader.js';

export interface ListNearbyMarketsDeps {
  readonly markets: MarketReader;
}

export interface NearbyMarket {
  readonly market: Market;
  /**
   * Metre, TAM SAYI (proto int32). Yuvarlama yaricap kuralini bozmaz: yaricap
   * tam sayi oldugu icin mesafe <= yaricap ise yuvarlanmis mesafe de <= yaricap.
   */
  readonly distanceMeters: number;
}

export type ListNearbyMarkets = (location: GeoPoint) => Promise<readonly NearbyMarket[]>;

export function createListNearbyMarkets(deps: ListNearbyMarketsDeps): ListNearbyMarkets {
  return async (location) => {
    const candidates = await deps.markets.listMarketsByDistance(location, MARKET_CANDIDATE_LIMIT);
    return coveringMarkets(candidates).map(({ market, distanceMeters }) => ({
      market,
      distanceMeters: Math.round(distanceMeters),
    }));
  };
}
