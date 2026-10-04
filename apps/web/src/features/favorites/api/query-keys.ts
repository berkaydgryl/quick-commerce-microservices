/**
 * Favori sorgu anahtarlari. Liste kullanici kimligiyle anahtarlanir: ayni
 * sekmede baska hesapla giris yapilirsa onceki hesabin favorileri gorunmez.
 */
export const favoriteKeys = {
  all: ['favorites'] as const,
  /** Kullanici yoksa null (oturumsuz): sorgu calismaz. */
  list: (userId: string | null) => [...favoriteKeys.all, 'list', userId] as const,
};
