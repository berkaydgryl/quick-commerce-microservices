import type { GeoPoint } from '@getir/contracts';

/**
 * Arama sorgu anahtarlari tek yerde. Arama metni anahtardadir: arama degisince
 * eski sorgunun gozlemcisi kalmaz ve istegi IPTAL edilir (T9.5 ile ayni).
 */
export const searchKeys = {
  all: ['search'] as const,
  /** Konum yoksa null (teslimat adresi cozuluyor, T9.5): hicbir konumun girdisiyle karismaz. */
  nearby: (location: GeoPoint | undefined, query: string) =>
    [...searchKeys.all, 'nearby', location?.lat ?? null, location?.lng ?? null, query] as const,
};
