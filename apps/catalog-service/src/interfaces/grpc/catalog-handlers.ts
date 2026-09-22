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
import { unaryHandler } from '@getir/service-kit';
import type { UntypedServiceImplementation } from '@grpc/grpc-js';
import { Metadata, status as GrpcStatus } from '@grpc/grpc-js';
import type { handleUnaryCall } from '@grpc/grpc-js';

import type { ListCategories } from '../../application/list-categories.js';
import type { ListProducts } from '../../application/list-products.js';
import { toProtoCategory, toProtoProduct } from './mappers.js';
import { listCategoriesRequestSchema, listProductsRequestSchema } from './schemas.js';

export interface CatalogHandlerDeps {
  readonly listCategories: ListCategories;
  readonly listProducts: ListProducts;
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
        };
      },
    }),

    // Sozlesmede tanimli ama HENUZ UYGULANMAMIS RPC'ler.
    //
    // Neden bos birakilmiyor: grpc-js, tanimda olup uygulamada olmayan her
    // metot icin acilista hata seviyesinde gunluk yazar - her acilista
    // "bir sey bozuk" izlenimi verir. Neden AppError degil: "bu uc henuz yok"
    // bir IS hatasi degil, protokol gercegi; karsiligi dogrudan UNIMPLEMENTED.
    getProduct: unimplemented('GetProduct', 'T4'),
    batchGetProducts: unimplemented('BatchGetProducts', 'T4'),
    resolveDarkStore: unimplemented('ResolveDarkStore', 'T4.2'),
  };
}

/** Henuz yazilmamis RPC'nin durus noktasi; hangi gorevde gelecegini soyler. */
function unimplemented(rpc: string, task: string): handleUnaryCall<unknown, never> {
  return (_call, callback) => {
    callback({
      name: 'ServiceError',
      message: `${rpc} henuz uygulanmadi (${task})`,
      code: GrpcStatus.UNIMPLEMENTED,
      details: `${rpc} henuz uygulanmadi (${task})`,
      metadata: new Metadata(),
    });
  };
}
