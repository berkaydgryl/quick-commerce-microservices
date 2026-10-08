/**
 * Use-case: genel arama (T9.6) - markete girmeden, konuma hizmet veren
 * marketlerde urun ya da market adi.
 *
 * IKI SORGU, market sayisindan bagimsiz (N+1 yok): konumu kapsayan marketler
 * (ListNearbyMarkets ile ayni kural) ve o marketlerin eslesen aktif teklifleri.
 * Dahil etme ve siralama kurali domain'de (buildNearbySearchResults).
 */

import type { GeoPoint } from '@getir/core';

import { MARKET_CANDIDATE_LIMIT, MAX_SEARCH_OFFERS_PER_MARKET } from '../config/constants.js';
import { coveringMarkets } from '../domain/market-coverage.js';
import type { MarketReader } from '../domain/market-reader.js';
import { buildNearbySearchResults } from '../domain/nearby-search.js';
import type { NearbySearchResult } from '../domain/nearby-search.js';
import type { OfferReader } from '../domain/offer-reader.js';

export interface SearchNearbyDeps {
  readonly markets: Pick<MarketReader, 'listCoveringMarkets'>;
  readonly offers: Pick<OfferReader, 'searchActiveOffers'>;
}

export interface SearchNearbyInput {
  readonly location: GeoPoint;
  readonly query: string;
}

export type SearchNearby = (input: SearchNearbyInput) => Promise<readonly NearbySearchResult[]>;

export function createSearchNearby(deps: SearchNearbyDeps): SearchNearby {
  return async ({ location, query }) => {
    // ListNearbyMarkets ile AYNI kaynak, sinir ve domain kurali (#175).
    const markets = coveringMarkets(
      await deps.markets.listCoveringMarkets(location, MARKET_CANDIDATE_LIMIT),
    );
    if (markets.length === 0) {
      return [];
    }
    const matches = await deps.offers.searchActiveOffers(
      markets.map((candidate) => candidate.market.id),
      query,
      MAX_SEARCH_OFFERS_PER_MARKET,
    );
    return buildNearbySearchResults(markets, matches, query);
  };
}
