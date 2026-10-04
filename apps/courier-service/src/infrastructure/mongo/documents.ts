/**
 * couriers koleksiyonunun Mongo'daki SEKLI. Alan adlari roadmap "MongoDB Veri
 * Modeli" tablosuyla ayni (_id, name, status, marketId, currentOrderId,
 * lastLocation). Istege bagli alanlar yoksa HIC yazilmaz: currentOrderId'nin
 * benzersiz indeksi kismidir, yalnizca alani olan belgeler girer.
 */

import type { BaseDocument } from '@getir/mongo-kit';

import type { CourierStatus } from '../../domain/courier.js';

export const COLLECTIONS = {
  COURIERS: 'couriers',
} as const;

export interface GeoPointDocument {
  lat: number;
  lng: number;
}

/** _id kurye kimligidir (crr_...). */
export interface CourierDocument extends BaseDocument {
  name: string;
  marketId: string;
  status: CourierStatus;
  currentOrderId?: string;
  lastAssignedAt?: Date;
  lastLocation: GeoPointDocument;
  lastLocationAt: Date;
}
