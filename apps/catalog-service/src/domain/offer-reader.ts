/**
 * Teklif okuma portu (ADR-15): bir marketin urunleri, o marketin fiyatiyla.
 */

import type { Offer } from './catalog.js';
import type { PageSlice } from './pagination.js';

/** Market sayfasi filtreleri. marketId ZORUNLU; digerleri verilmezse "filtreleme". */
export interface OfferFilter {
  readonly marketId: string;
  readonly categoryId?: string;
  readonly query?: string;
}

export interface PageQuery {
  readonly size: number;
  /** Onceki cevaptan gelen imlec; ilk sayfada bos. */
  readonly token: string;
}

/** Bir marketteki arama eslesmeleri (T9.6): ilk birkaci + toplam sayi. */
export interface MarketOfferMatches {
  readonly marketId: string;
  /** Eslesen aktif teklifler, market sayfasiyla ayni sirada (_id), en fazla perMarket. */
  readonly offers: readonly Offer[];
  /** Bu marketteki toplam eslesen aktif teklif; offers'tan fazla olabilir. */
  readonly totalMatches: number;
}

/** Sayfa + toplam sayim. */
export interface OfferPage extends PageSlice<Offer> {
  /** Filtreye uyan toplam kayit sayisi. */
  readonly totalSize: number;
}

export interface OfferReader {
  listOffers(filter: OfferFilter, page: PageQuery): Promise<OfferPage>;
  /** Marketin en az bir AKTIF teklifi olan kategori kimlikleri. */
  listCategoryIdsWithOffers(marketId: string): Promise<readonly string[]>;
  /**
   * Marketin verilen urunlere ait teklifleri, TEK sorguda (N+1 yok, T9.3).
   * Pasif teklifler DAHILDIR ve sira garantisi yoktur: "satilir mi" karari
   * depo degil use-case isidir (batch-get-offers.ts). Bilinmeyen kimlik
   * sessizce yoktur; eksikleri cagiran hesaplar.
   */
  findOffersByProductIds(
    marketId: string,
    productIds: readonly string[],
  ): Promise<readonly Offer[]>;
  /**
   * Genel arama (T9.6): verilen marketlerin sorguyla eslesen AKTIF teklifleri,
   * TEK sorguda (market sayisindan bagimsiz). Eslesme kurali market ici
   * aramayla ayni (searchWords). Eslesmesi olmayan market listede yoktur;
   * sira garantisi yoktur (siralama use-case'in isidir).
   */
  searchActiveOffers(
    marketIds: readonly string[],
    query: string,
    perMarket: number,
  ): Promise<readonly MarketOfferMatches[]>;
}
