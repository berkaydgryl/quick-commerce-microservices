/**
 * couriers ve markets koleksiyonlarinin Mongo'daki SEKLI. Istege bagli
 * alanlar yoksa HIC yazilmaz: currentOrderId'nin benzersiz indeksi kismidir,
 * yalnizca alani olan belgeler girer.
 *
 * Konumlar GeoJSON Point'tir (T13.2): havuz sorgusu 2dsphere indeksiyle
 * ($geoNear) calisir. Siralama [boylam, enlem]; domain'deki {lat, lng}'ye
 * ceviri mappers.ts'te.
 */

import type { BaseDocument } from '@getir/mongo-kit';

import type { CourierStatus } from '../../domain/courier.js';

export const COLLECTIONS = {
  COURIERS: 'couriers',
  /** Market konumu kopyasi (T13.2); kaydin sahibi catalog (ADR-05). */
  MARKETS: 'markets',
  /** Siparisin kurye rotasi (T13.2): kurye -> market -> adres. */
  ROUTES: 'routes',
} as const;

export interface GeoJsonPoint {
  type: 'Point';
  /** [boylam, enlem] */
  coordinates: [number, number];
}

/** _id kurye kimligidir (crr_...). */
export interface CourierDocument extends BaseDocument {
  name: string;
  status: CourierStatus;
  currentOrderId?: string;
  lastAssignedAt?: Date;
  /** Yalnizca IDLE iken (T13.2, #88). */
  idleSince?: Date;
  lastLocation: GeoJsonPoint;
  lastLocationAt: Date;
}

/** _id market kimligidir (mkt_...). */
export interface MarketDocument extends BaseDocument {
  location: GeoJsonPoint;
}

/**
 * _id siparis kimligidir (ord_...): siparis basina tek rota. Noktalar duz
 * {lat, lng}: rota uzerinde geo sorgusu yok (ayni noktalar da gecerli).
 */
export interface RouteDocument extends BaseDocument {
  courierId: string;
  points: { lat: number; lng: number }[];
  pickupIndex: number;
  distanceMeters: number;
  etaSeconds: number;
  createdAt: Date;
}
