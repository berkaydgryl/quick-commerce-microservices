/**
 * Marketin siparis kosullari: market acik mi (#154) ve aciksa sepet kurallari
 * ile teslimat yaricapi (#203).
 *
 * Kapali market siparis ALMAZ: taslak acilmaz, stoga dokunulmaz. Kod ve sebep
 * catalog.proto'daki kararla ayni: kapali market NO_STORE (gRPC NOT_FOUND, HTTP
 * 404), sebep "STORE_CLOSED"; kullanici icin sonuc yaricap disiyla ayni (siparis
 * verilemez). Tasima servislerin tek hata kanalidir (x-app-error ayrintisi);
 * mesafe anahtari (nearest_distance_meters) tasinmaz. "Acik mi" catalog'da
 * duragan bir bayraktir (calisma saati yok).
 *
 * Yaricap disi teslimat adresi (#203) ayni kodla doner, sebep "OUT_OF_RANGE".
 * Kural catalog kapsamasiyla ORTAK (@getir/core distanceMeters +
 * isOutsideDeliveryRadius; sinir dahil). Mongo $geoNear ile +-1 m fark: yaricap
 * sinirinda listede gorunen market nadiren yaricap disi sayilabilir (KABUL).
 */

import { AppError, distanceMeters, ERROR_CODES, isOutsideDeliveryRadius } from '@getir/core';
import type { GeoPoint } from '@getir/core';
import type { PricingRules } from '@getir/pricing';

/** NO_STORE ayrintisindaki sebep (catalog.proto ile ayni yazim). */
export const MARKET_CLOSED_REASON = 'STORE_CLOSED';

/** Teslimat adresi marketin yaricapi disinda (#203; catalog T4.2 terimi). */
export const OUT_OF_RANGE_REASON = 'OUT_OF_RANGE';

/**
 * Acik market: sepet kurallari (minimum sepet, teslimat ucreti, ucretsiz esik),
 * konumu ve teslimat yaricapi.
 */
export interface OpenMarketTerms {
  readonly isOpen: true;
  readonly rules: PricingRules;
  readonly location: GeoPoint;
  readonly deliveryRadiusMeters: number;
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

/** Teslimat adresinin acik marketin yaricapina gore olcumu (#203). */
export interface DeliveryReach {
  readonly distanceMeters: number;
  readonly outside: boolean;
}

/** Teslimat adresi marketin yaricapi disinda mi? Sinir dahil (catalog kapsamasiyla ayni). */
export function deliveryReach(terms: OpenMarketTerms, delivery: GeoPoint): DeliveryReach {
  const distance = distanceMeters(terms.location, delivery);
  return {
    distanceMeters: distance,
    outside: isOutsideDeliveryRadius(distance, terms.deliveryRadiusMeters),
  };
}

/** Yaricap disi teslimat: NO_STORE, ayrinti YALNIZCA sebep (mesafe ve konum yankilanmaz). */
export function outOfDeliveryRange(): AppError {
  return new AppError(ERROR_CODES.NO_STORE, 'Teslimat adresi market yaricapi disinda', {
    details: { reason: OUT_OF_RANGE_REASON },
  });
}
