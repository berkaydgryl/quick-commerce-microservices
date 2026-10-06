/**
 * Kart sorgu anahtarlari (T11.17). Kullanici kimligiyle anahtarlanir: ayni
 * sekmede baska hesapla giris yapilirsa onceki hesabin kartlari gorunmez.
 * Onbellekte yalnizca maskeli liste durur (M7).
 */
export const cardKeys = {
  all: ['cards'] as const,
  list: (userId: string) => [...cardKeys.all, 'list', userId] as const,
};
