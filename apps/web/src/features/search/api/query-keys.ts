import type { GeoPoint } from '@getir/contracts';

/**
 * Arama sorgu anahtarlari tek yerde. Arama metni anahtardadir: arama degisince
 * eski sorgunun gozlemcisi kalmaz ve istegi IPTAL edilir (T9.5 ile ayni).
 */
export const searchKeys = {
  all: ['search'] as const,
  nearby: (location: GeoPoint, query: string) =>
    [...searchKeys.all, 'nearby', location.lat, location.lng, query] as const,
};
