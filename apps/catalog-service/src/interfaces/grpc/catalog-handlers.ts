/**
 * CatalogService gRPC handler'lari.
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

import type { ListCategories } from '../../application/list-categories.js';
import type { ListProducts } from '../../application/list-products.js';
import type { ResolveDarkStore } from '../../application/resolve-dark-store.js';
import { toProtoCategory, toProtoDarkStore, toProtoProduct } from './mappers.js';
import {
  listCategoriesRequestSchema,
  listProductsRequestSchema,
  resolveDarkStoreRequestSchema,
} from './schemas.js';

export interface CatalogHandlerDeps {
  readonly listCategories: ListCategories;
  readonly listProducts: ListProducts;
  readonly resolveDarkStore: ResolveDarkStore;
  readonly logger?: Logger;
}

export function createCatalogImplementation(
  deps: CatalogHandlerDeps,
): UntypedServiceImplementation {
  const logger = deps.logger;

  return {
    listCategories: unaryHandler({
      name: 'ListCategories',
      schema: listCategoriesRequestSchema,
      ...(logger === undefined ? {} : { logger }),
      handle: async (): Promise<catalogV1.ListCategoriesResponse> => ({
        categories: (await deps.listCategories()).map(toProtoCategory),
      }),
    }),

    listProducts: unaryHandler({
      name: 'ListProducts',
      schema: listProductsRequestSchema,
      ...(logger === undefined ? {} : { logger }),
      handle: async (input): Promise<catalogV1.ListProductsResponse> => {
        const page = await deps.listProducts({
          filter: {
            ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
            ...(input.darkStoreId === undefined ? {} : { darkStoreId: input.darkStoreId }),
            ...(input.query === undefined ? {} : { query: input.query }),
          },
          pageSize: input.page?.pageSize,
          pageToken: input.page?.pageToken,
        });

        return {
          products: page.items.map(toProtoProduct),
          page: { nextPageToken: page.nextPageToken, totalSize: page.totalSize },
          // T4.7 sozlesmesi (ADR-15): teklifler T4.8'de doldurulur.
          offers: [],
        };
      },
    }),

    resolveDarkStore: unaryHandler({
      name: 'ResolveDarkStore',
      schema: resolveDarkStoreRequestSchema,
      ...(logger === undefined ? {} : { logger }),
      handle: async (input): Promise<catalogV1.ResolveDarkStoreResponse> => {
        const resolved = await deps.resolveDarkStore(input.location);
        return {
          darkStore: toProtoDarkStore(resolved.store),
          distanceMeters: resolved.distanceMeters,
        };
      },
    }),

    // Sozlesmede tanimli ama HENUZ UYGULANMAMIS RPC'ler; gerekce
    // @getir/service-kit grpc/unimplemented.ts'te.
    getProduct: unimplemented('GetProduct', 'T4'),
    batchGetProducts: unimplemented('BatchGetProducts', 'T4'),
    // Pazaryeri RPC'leri (T4.7 sozlesmesi): uygulamasi T4.8.
    listNearbyMarkets: unimplemented('ListNearbyMarkets', 'T4.8'),
    getMarket: unimplemented('GetMarket', 'T4.8'),
    listMarketCategories: unimplemented('ListMarketCategories', 'T4.8'),
    batchGetOffers: unimplemented('BatchGetOffers', 'T9.3'),
  };
}
