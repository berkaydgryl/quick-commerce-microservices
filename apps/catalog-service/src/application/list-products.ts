/**
 * Use-case: filtreli ve sayfali urun listesi.
 */

import { AppError } from '@getir/core';

import type { DarkStoreReader } from '../domain/dark-store-reader.js';
import { normalizePageSize } from '../domain/pagination.js';
import type { ProductFilter, ProductPage, ProductReader } from '../domain/product-reader.js';

export interface ListProductsDeps {
  readonly products: ProductReader;
  /** Yalnizca depo varligi icin (NOT_FOUND ile bos liste ayrimi). */
  readonly darkStores: DarkStoreReader;
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
      !(await deps.darkStores.darkStoreExists(filter.darkStoreId))
    ) {
      throw AppError.notFound('Depo bulunamadi', {
        details: { darkStoreId: filter.darkStoreId },
      });
    }

    return deps.products.listProducts(filter, {
      size: normalizePageSize(pageSize),
      token: pageToken ?? '',
    });
  };
}
