/**
 * Bir marketin katalogu (ADR-15): teklifi olan kategoriler ve urunler, o
 * marketin fiyatiyla. GET /v1/markets/{marketId}/categories ve /products.
 */

import { categoryListSchema, productPageSchema } from '@getir/contracts';
import type {
  CategoryList,
  MarketId,
  marketProductsQuerySchema,
  Page,
  ProductPage,
} from '@getir/contracts';
import type { z } from 'zod';

import type { HttpClient } from '../../../shared/api/http-client';

/** Sozlesmedeki urun sorgusunun GIRDI bicimi (sunucu cozmeden onceki hali). */
type MarketProductsQueryInput = z.input<typeof marketProductsQuerySchema>;

/**
 * Urun listesi istegi. Alan tipleri SOZLESMEDEN turetilir: sozlesmede bir
 * alanin tipi degisirse burasi derlenmez, elle yazilmis kopya gibi sessizce
 * ayrismaz (D11). marketId yol parametresidir, sorguda degil.
 *
 * Adi sozlesmedeki `MarketProductsQuery`'den BILEREK farkli: o, sunucunun
 * cozdugu sorgudur (pageSize varsayilanli ve kirpilmis); bu, istemcinin
 * gonderdigi. Istemci pageSize'i her istekte gonderir.
 */
export interface MarketProductsRequest {
  readonly marketId: MarketId;
  readonly categoryId?: MarketProductsQueryInput['categoryId'];
  /** Arama (T9.5): sunucuda ad ve aciklamada, harf ve Turkce karakter duyarsiz (T9.4). */
  readonly query?: MarketProductsQueryInput['q'];
  readonly pageToken?: MarketProductsQueryInput['pageToken'];
  readonly pageSize: NonNullable<MarketProductsQueryInput['pageSize']>;
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
  { marketId, categoryId, query, pageToken, pageSize }: MarketProductsRequest,
  signal?: AbortSignal,
): Promise<ProductPage> {
  // Yalnizca DOLU filtreler gonderilir: bos deger sunucuda zaten "filtre yok"
  // sayilir; gondermemek adresi ve istek gunlugunu sade tutar.
  const params = new URLSearchParams({ pageSize: String(pageSize) });
  if (categoryId !== undefined) params.set('categoryId', categoryId);
  if (query !== undefined) params.set('q', query);
  if (pageToken !== undefined) params.set('pageToken', pageToken);

  return client.request(`${marketPath(marketId)}/products?${params.toString()}`, {
    schema: productPageSchema,
    signal,
  });
}

/** Imlec: bos token listenin bittigi demektir (sozlesme), undefined'a cevrilir. */
export function nextPageToken(page: Page): string | undefined {
  return page.nextPageToken === '' ? undefined : page.nextPageToken;
}
