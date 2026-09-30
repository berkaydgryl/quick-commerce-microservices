/**
 * Adres sorgu anahtarlari. Defter kullanici kimligiyle anahtarlanir: ayni
 * sekmede baska hesapla giris yapilirsa onceki hesabin adresleri gorunmez.
 */
export const addressKeys = {
  all: ['addresses'] as const,
  /** Kullanici yoksa null (oturumsuz): sorgu calismaz, anahtari hicbir kullanicininkiyle karismaz. */
  list: (userId: string | null) => [...addressKeys.all, 'list', userId] as const,
};
