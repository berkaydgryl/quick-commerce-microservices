/**
 * Servisin gocleri (T10.4, ADR-19), uygulanma sirasiyla. couriers koleksiyonu
 * ilk surumunde indeksleriyle (couriers-collection.ts) geldi; sema ya da veri
 * degisikligi buraya goc olarak eklenir. Uygulanmis goc degistirilmez.
 */

import type { Migration } from '@getir/mongo-kit';

import { courierPool } from './0001-kurye-havuzu.js';

export const MIGRATIONS: readonly Migration[] = [courierPool];
