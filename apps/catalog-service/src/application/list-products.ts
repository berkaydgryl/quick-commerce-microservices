/**
 * Use-case: filtreli ve sayfali urun listesi.
 */

import { AppError } from '@getir/core';

import type {
  CatalogRepository,
  ProductFilter,
  ProductPage,
} from '../domain/catalog-repository.js';
import { normalizePageSize } from '../domain/pagination.js';

export interface ListProductsDeps {
  readonly repository: CatalogRepository;
}

export interface ListProductsInput {
  readonly filter: ProductFilter;
  readonly pageSize?: number | undefined;
  readonly pageToken?: string | undefined;
}

export type ListProducts = (input: ListProductsInput) => Promise<ProductPage>;

export function createListProducts(deps: ListProductsDeps): ListProducts {
  return async ({ filter, pageSize, pageToken }) => {
    // SOZLESME AYRIMI (catalog.proto, ListProductsResponse yorumu):
    // depo YOKSA bu bir hatadir (NOT_FOUND) - istemcide "depo secimi bozuldu"
    // ekrani cikar. Depo VAR ama filtreye uyan urun yoksa BOS liste doner,
    // hata degil - istemcide "bu kategoride urun yok" ekrani cikar.
    if (
      filter.darkStoreId !== undefined &&
      !(await deps.repository.darkStoreExists(filter.darkStoreId))
    ) {
      throw AppError.notFound('Depo bulunamadi', {
        details: { darkStoreId: filter.darkStoreId },
      });
    }

    return deps.repository.listProducts(filter, {
      size: normalizePageSize(pageSize),
      token: pageToken ?? '',
    });
  };
}
