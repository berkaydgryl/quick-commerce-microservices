/**
 * Use-case: market sayfasinin basligi (puan, sure, fiyat kurallari).
 */

import { AppError } from '@getir/core';

import type { Market } from '../domain/catalog.js';
import type { MarketReader } from '../domain/market-reader.js';

export interface GetMarketDeps {
  readonly markets: MarketReader;
}

export type GetMarket = (marketId: string) => Promise<Market>;

export function createGetMarket(deps: GetMarketDeps): GetMarket {
  return async (marketId) => {
    const market = await deps.markets.getMarket(marketId);
    if (market === null) {
      throw AppError.notFound('Market bulunamadi', { details: { marketId } });
    }
    return market;
  };
}
