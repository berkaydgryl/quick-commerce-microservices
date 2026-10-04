/**
 * Servisin gocleri (T10.4, ADR-19), uygulanma sirasiyla. Bos: couriers
 * koleksiyonu ilk surumunde indeksleriyle (couriers-collection.ts) gelir;
 * sema ya da veri degisikligi bundan sonra buraya goc olarak eklenir.
 */

import type { Migration } from '@getir/mongo-kit';

export const MIGRATIONS: readonly Migration[] = [];
