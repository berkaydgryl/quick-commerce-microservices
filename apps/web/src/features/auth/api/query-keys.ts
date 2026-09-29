/**
 * Kimlik sorgu anahtarlari. Profil kullanici kimligiyle anahtarlanir: ayni
 * sekmede baska hesapla giris yapilirsa onceki hesabin profili gorunmez.
 */
export const authKeys = {
  all: ['auth'] as const,
  profile: (userId: string) => [...authKeys.all, 'profile', userId] as const,
};
