/**
 * CatalogService gRPC handler'lari (ADR-15: pazaryeri).
 *
 * Handler'in isi UCTUR ve ucu de burada bitiyor: dogrula (sema), use-case'i
 * cagir, cevabi sozlesme bicimine cevir. Is kurali yok, sorgu yok, try/catch
 * yok - hata cevirisi ve gunlukleme @getir/service-kit'in unaryHandler ara
 * katmanindadir.
 */

import type { Logger } from '@getir/core';
import type { catalogV1 } from '@getir/proto';
import { unaryHandler, unimplemented } from '@getir/service-kit';
import type { UntypedServiceImplementation } from '@grpc/grpc-js';

import type { BatchGetMarkets } from '../../application/batch-get-markets.js';
import type { BatchGetOffers } from '../../application/batch-get-offers.js';
import type { GetMarket } from '../../application/get-market.js';
import type { ListCategories } from '../../application/list-categories.js';
import type { ListMarketCategories } from '../../application/list-market-categories.js';
import type { ListNearbyMarkets } from '../../application/list-nearby-markets.js';
import type { ListProducts } from '../../application/list-products.js';
import type { SearchNearby } from '../../application/search-nearby.js';
import {
  toListProductsResponse,
  toProtoCategory,
  toProtoMarketSearchResult,
  toProtoMarket,
  toProtoNearbyMarket,
  toProtoOffer,
} from './mappers.js';
import {
  batchGetMarketsRequestSchema,
  batchGetOffersRequestSchema,
  getMarketRequestSchema,
  listCategoriesRequestSchema,
  listMarketCategoriesRequestSchema,
  listNearbyMarketsRequestSchema,
  listProductsRequestSchema,
  searchNearbyRequestSchema,
} from './schemas.js';

export interface CatalogHandlerDeps {
  readonly listCategories: ListCategories;
  readonly listNearbyMarkets: ListNearbyMarkets;
  readonly getMarket: GetMarket;
  readonly listMarketCategories: ListMarketCategories;
  readonly listProducts: ListProducts;
  readonly batchGetOffers: BatchGetOffers;
  readonly batchGetMarkets: BatchGetMarkets;
  readonly searchNearby: SearchNearby;
  readonly logger?: Logger;
}

export function createCatalogImplementation(
  deps: CatalogHandlerDeps,
): UntypedServiceImplementation {
  const logger = deps.logger === undefined ? {} : { logger: deps.logger };

  return {
    listCategories: unaryHandler({
      name: 'ListCategories',
      schema: listCategoriesRequestSchema,
      ...logger,
      handle: async (): Promise<catalogV1.ListCategoriesResponse> => ({
        categories: (await deps.listCategories()).map(toProtoCategory),
      }),
    }),

    listNearbyMarkets: unaryHandler({
      name: 'ListNearbyMarkets',
      schema: listNearbyMarketsRequestSchema,
      ...logger,
      handle: async (input): Promise<catalogV1.ListNearbyMarketsResponse> => ({
        markets: (await deps.listNearbyMarkets(input.location)).map(toProtoNearbyMarket),
      }),
    }),

    getMarket: unaryHandler({
      name: 'GetMarket',
      schema: getMarketRequestSchema,
      ...logger,
      handle: async (input): Promise<catalogV1.GetMarketResponse> => ({
        market: toProtoMarket(await deps.getMarket(input.marketId)),
      }),
    }),

    listMarketCategories: unaryHandler({
      name: 'ListMarketCategories',
      schema: listMarketCategoriesRequestSchema,
      ...logger,
      handle: async (input): Promise<catalogV1.ListMarketCategoriesResponse> => ({
        categories: (await deps.listMarketCategories(input.marketId)).map(toProtoCategory),
      }),
    }),

    listProducts: unaryHandler({
      name: 'ListProducts',
      schema: listProductsRequestSchema,
      ...logger,
      handle: async (input): Promise<catalogV1.ListProductsResponse> =>
        toListProductsResponse(await deps.listProducts(input)),
    }),

    // DEPRECATED (ADR-15): sistem market atamaz, kullanici secer. Sozlesmede
    // duruyor (buf breaking), uygulamasi bilerek yok; mesaj yerini soyler.
    resolveDarkStore: unimplemented(
      'ResolveDarkStore',
      'deprecated - ListNearbyMarkets kullanin',
      deps.logger,
    ),

    // Sozlesmede tanimli ama HENUZ UYGULANMAMIS RPC'ler: NOT_IMPLEMENTED (501),
    // gerekce @getir/service-kit grpc/unimplemented.ts'te.
    getProduct: unimplemented('GetProduct', 'T8.4', deps.logger),
    // Fiyatsiz urun okumasi: pazaryerinde (ADR-15) fiyat teklife ait oldugu icin
    // sepet dogrulamasi BatchGetOffers ile yapilir; bu RPC'yi kullanan yok.
    batchGetProducts: unimplemented(
      'BatchGetProducts',
      'kullanan yok - BatchGetOffers kullanin',
      deps.logger,
    ),

    searchNearby: unaryHandler({
      name: 'SearchNearby',
      schema: searchNearbyRequestSchema,
      ...logger,
      handle: async (input): Promise<catalogV1.SearchNearbyResponse> => ({
        results: (await deps.searchNearby(input)).map(toProtoMarketSearchResult),
      }),
    }),

    batchGetOffers: unaryHandler({
      name: 'BatchGetOffers',
      schema: batchGetOffersRequestSchema,
      ...logger,
      handle: async (input): Promise<catalogV1.BatchGetOffersResponse> => {
        const result = await deps.batchGetOffers(input);
        return { offers: result.offers.map(toProtoOffer), missing: [...result.missing] };
      },
    }),

    batchGetMarkets: unaryHandler({
      name: 'BatchGetMarkets',
      schema: batchGetMarketsRequestSchema,
      ...logger,
      handle: async (input): Promise<catalogV1.BatchGetMarketsResponse> => {
        const result = await deps.batchGetMarkets(input.marketIds);
        return { markets: result.markets.map(toProtoMarket), missing: [...result.missing] };
      },
    }),
  };
}
