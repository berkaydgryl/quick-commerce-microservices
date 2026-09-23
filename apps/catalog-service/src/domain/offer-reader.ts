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

/** Sayfa + toplam sayim. */
export interface OfferPage extends PageSlice<Offer> {
  /** Filtreye uyan toplam kayit sayisi. */
  readonly totalSize: number;
}

export interface OfferReader {
  listOffers(filter: OfferFilter, page: PageQuery): Promise<OfferPage>;
  /** Marketin en az bir AKTIF teklifi olan kategori kimlikleri. */
  listCategoryIdsWithOffers(marketId: string): Promise<readonly string[]>;
}
