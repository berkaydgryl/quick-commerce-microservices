/**
 * Use-case: bir marketin urunleri, o marketin fiyatiyla (ADR-15).
 */

import { AppError } from '@getir/core';

import type { MarketReader } from '../domain/market-reader.js';
import type { OfferFilter, OfferPage, OfferReader } from '../domain/offer-reader.js';
import { normalizePageSize } from '../domain/pagination.js';

export interface ListProductsDeps {
  readonly offers: OfferReader;
  /** Yalnizca market varligi icin (NOT_FOUND ile bos liste ayrimi). */
  readonly markets: MarketReader;
}

export interface ListProductsInput {
  readonly filter: OfferFilter;
  readonly pageSize?: number | undefined;
  readonly pageToken?: string | undefined;
}

export type ListProducts = (input: ListProductsInput) => Promise<OfferPage>;

export function createListProducts(deps: ListProductsDeps): ListProducts {
  return async ({ filter, pageSize, pageToken }) => {
    // SOZLESME AYRIMI (catalog.proto, ListProductsResponse yorumu): market
    // YOKSA bu bir hatadir (NOT_FOUND) - istemcide "market secimi bozuldu"
    // ekrani cikar. Market VAR ama filtreye uyan urun yoksa BOS liste doner.
    if (!(await deps.markets.marketExists(filter.marketId))) {
      throw AppError.notFound('Market bulunamadi', { details: { marketId: filter.marketId } });
    }

    return deps.offers.listOffers(filter, {
      size: normalizePageSize(pageSize),
      token: pageToken ?? '',
    });
  };
}
