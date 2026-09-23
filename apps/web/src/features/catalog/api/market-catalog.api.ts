/**
 * Bir marketin katalogu (ADR-15): teklifi olan kategoriler ve urunler, o
 * marketin fiyatiyla. GET /v1/markets/{marketId}/categories ve /products.
 */

import { categoryListSchema, productPageSchema } from '@getir/contracts';
import type { CategoryList, Page, ProductPage } from '@getir/contracts';

import type { HttpClient } from '../../../shared/api/http-client';

export interface MarketProductsQuery {
  readonly marketId: string;
  readonly categoryId?: string | undefined;
  readonly pageToken?: string | undefined;
  readonly pageSize: number;
}

const marketPath = (marketId: string): string => `/v1/markets/${encodeURIComponent(marketId)}`;

export function fetchMarketCategories(
  client: HttpClient,
  marketId: string,
  signal?: AbortSignal,
): Promise<CategoryList> {
  return client.request(`${marketPath(marketId)}/categories`, {
    schema: categoryListSchema,
    signal,
  });
}

export function fetchMarketProducts(
  client: HttpClient,
  { marketId, categoryId, pageToken, pageSize }: MarketProductsQuery,
  signal?: AbortSignal,
): Promise<ProductPage> {
  // Yalnizca DOLU filtreler gonderilir: bos deger sunucuda zaten "filtre yok"
  // sayilir; gondermemek adresi ve istek gunlugunu sade tutar.
  const query = new URLSearchParams({ pageSize: String(pageSize) });
  if (categoryId !== undefined) query.set('categoryId', categoryId);
  if (pageToken !== undefined) query.set('pageToken', pageToken);

  return client.request(`${marketPath(marketId)}/products?${query.toString()}`, {
    schema: productPageSchema,
    signal,
  });
}

/** Imlec: bos token listenin bittigi demektir (sozlesme), undefined'a cevrilir. */
export function nextPageToken(page: Page): string | undefined {
  return page.nextPageToken === '' ? undefined : page.nextPageToken;
}
