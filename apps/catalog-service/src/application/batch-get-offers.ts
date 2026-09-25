/**
 * Use-case: bir marketin verilen urunlere ait SATILABILIR tekliflerini toplu
 * okur (T9.3). Siparis fiyat dogrulamasinin (T7.2) kaynagidir: sepetteki her
 * kalemin o marketteki fiyati TEK sorguda gelir (N+1 yok).
 *
 * Kurallar:
 *  - Market YOKSA NOT_FOUND (ListProducts ile ayni sozlesme ayrimi).
 *  - Yalnizca AKTIF teklif "satilir"dir. Pasif teklif (market urunu satistan
 *    kaldirmis), baska marketin urunu ve hic olmayan kimlik `missing`'e duser:
 *    sessizce ATLANMAZ, cagiran "hangi kalem satilamaz" diye tek tek bilir.
 *  - Tekrarlanan kimlik tek sayilir; cevap istek sirasini korur (sozlesme sira
 *    vaat etmez ama belirlenebilir sira test ve gunlugu kolaylastirir).
 */

import { AppError } from '@getir/core';

import type { Offer } from '../domain/catalog.js';
import type { MarketReader } from '../domain/market-reader.js';
import type { OfferReader } from '../domain/offer-reader.js';

export interface BatchGetOffersDeps {
  readonly offers: Pick<OfferReader, 'findOffersByProductIds'>;
  /** Yalnizca market varligi icin. */
  readonly markets: Pick<MarketReader, 'marketExists'>;
}

export interface BatchGetOffersInput {
  readonly marketId: string;
  readonly productIds: readonly string[];
}

export interface BatchGetOffersResult {
  /** Satilabilir teklifler, istek sirasinda. */
  readonly offers: readonly Offer[];
  /** Bu marketin SATMADIGI kimlikler (pasif, baska marketin ya da hic olmayan), istek sirasinda. */
  readonly missing: readonly string[];
}

export type BatchGetOffers = (input: BatchGetOffersInput) => Promise<BatchGetOffersResult>;

export function createBatchGetOffers(deps: BatchGetOffersDeps): BatchGetOffers {
  return async ({ marketId, productIds }) => {
    if (!(await deps.markets.marketExists(marketId))) {
      throw AppError.notFound('Market bulunamadi', { details: { marketId } });
    }

    const unique = [...new Set(productIds)];
    const found = await deps.offers.findOffersByProductIds(marketId, unique);
    const sellable = new Map(
      found.filter((offer) => offer.isActive).map((offer) => [offer.product.id, offer]),
    );

    return {
      offers: unique.flatMap((id) => {
        const offer = sellable.get(id);
        return offer === undefined ? [] : [offer];
      }),
      missing: unique.filter((id) => !sellable.has(id)),
    };
  };
}
