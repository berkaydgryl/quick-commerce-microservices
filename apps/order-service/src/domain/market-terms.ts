/**
 * Marketin siparis kosullari (#154): market acik mi ve aciksa sepet kurallari.
 *
 * Kapali market siparis ALMAZ: taslak acilmaz, stoga dokunulmaz. Kod ve sebep
 * catalog.proto'daki kararla ayni: kapali market NO_STORE (gRPC NOT_FOUND, HTTP
 * 404), sebep "STORE_CLOSED"; kullanici icin sonuc yaricap disiyla ayni (siparis
 * verilemez). Tasima servislerin tek hata kanalidir (x-app-error ayrintisi);
 * mesafe anahtari (nearest_distance_meters) tasinmaz. "Acik mi" catalog'da
 * duragan bir bayraktir (calisma saati yok).
 */

import { AppError, ERROR_CODES } from '@getir/core';
import type { PricingRules } from '@getir/pricing';

/** NO_STORE ayrintisindaki sebep (catalog.proto ile ayni yazim). */
export const MARKET_CLOSED_REASON = 'STORE_CLOSED';

/** Acik market: sepet kurallari (minimum sepet, teslimat ucreti, ucretsiz esik). */
export interface OpenMarketTerms {
  readonly isOpen: true;
  readonly rules: PricingRules;
}

/**
 * Kapali marketin kurallari OKUNMAZ: kural verisi eksik ya da bozuk olsa da
 * cevap NO_STORE'dur (500 degil).
 */
export interface ClosedMarketTerms {
  readonly isOpen: false;
}

export type MarketTerms = OpenMarketTerms | ClosedMarketTerms;

/**
 * Kapali markette NO_STORE firlatir. Ayrinti YALNIZCA sebeptir: market kimligi
 * ya da adi yankilanmaz (istemci hangi marketi istedigini zaten biliyor).
 */
export function assertMarketOpen(terms: MarketTerms): asserts terms is OpenMarketTerms {
  if (!terms.isOpen) {
    throw new AppError(ERROR_CODES.NO_STORE, 'Market kapali', {
      details: { reason: MARKET_CLOSED_REASON },
    });
  }
}
