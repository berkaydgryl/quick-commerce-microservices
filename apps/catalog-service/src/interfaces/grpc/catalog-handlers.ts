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

import type { GetMarket } from '../../application/get-market.js';
import type { ListCategories } from '../../application/list-categories.js';
import type { ListMarketCategories } from '../../application/list-market-categories.js';
import type { ListNearbyMarkets } from '../../application/list-nearby-markets.js';
import type { ListProducts } from '../../application/list-products.js';
import { toProtoCategory, toProtoMarket, toProtoOffer } from './mappers.js';
import {
  getMarketRequestSchema,
  listCategoriesRequestSchema,
  listMarketCategoriesRequestSchema,
  listNearbyMarketsRequestSchema,
  listProductsRequestSchema,
} from './schemas.js';

export interface CatalogHandlerDeps {
  readonly listCategories: ListCategories;
  readonly listNearbyMarkets: ListNearbyMarkets;
  readonly getMarket: GetMarket;
  readonly listMarketCategories: ListMarketCategories;
  readonly listProducts: ListProducts;
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
        markets: (await deps.listNearbyMarkets(input.location)).map(
          ({ market, distanceMeters }) => ({
            market: toProtoMarket(market),
            distanceMeters,
          }),
        ),
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
      handle: async ({
        marketId,
        categoryId,
        query,
        page,
      }): Promise<catalogV1.ListProductsResponse> => {
        const result = await deps.listProducts({
          filter: {
            marketId,
            ...(categoryId === undefined ? {} : { categoryId }),
            ...(query === undefined ? {} : { query }),
          },
          pageSize: page?.pageSize,
          pageToken: page?.pageToken,
        });
        return {
          // Deprecated alan (ADR-15): fiyatsiz urun listesi artik doldurulmaz.
          products: [],
          offers: result.items.map(toProtoOffer),
          page: { nextPageToken: result.nextPageToken, totalSize: result.totalSize },
        };
      },
    }),

    // DEPRECATED (ADR-15): sistem market atamaz, kullanici secer. Sozlesmede
    // duruyor (buf breaking), uygulamasi bilerek yok; mesaj yerini soyler.
    resolveDarkStore: unimplemented('ResolveDarkStore', 'deprecated - ListNearbyMarkets kullanin'),

    // Sozlesmede tanimli ama HENUZ UYGULANMAMIS RPC'ler; gerekce
    // @getir/service-kit grpc/unimplemented.ts'te.
    getProduct: unimplemented('GetProduct', 'T8.4'),
    batchGetProducts: unimplemented('BatchGetProducts', 'T9.3'),
    batchGetOffers: unimplemented('BatchGetOffers', 'T9.3'),
  };
}
