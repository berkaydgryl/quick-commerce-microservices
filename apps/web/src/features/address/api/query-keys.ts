import type { GeoPoint } from '@getir/contracts';

/**
 * Adres sorgu anahtarlari. Defter kullanici kimligiyle anahtarlanir: ayni
 * sekmede baska hesapla giris yapilirsa onceki hesabin adresleri gorunmez.
 */
export const addressKeys = {
  all: ['addresses'] as const,
  /** Kullanici yoksa null (oturumsuz): sorgu calismaz, anahtari hicbir kullanicininkiyle karismaz. */
  list: (userId: string | null) => [...addressKeys.all, 'list', userId] as const,
  /** Harita adres servisi (T11.8): nokta ve arama metniyle; kullaniciya bagli degil. */
  reverse: (point: GeoPoint) => [...addressKeys.all, 'reverse', point.lat, point.lng] as const,
  search: (query: string | undefined) => [...addressKeys.all, 'search', query ?? null] as const,
};
