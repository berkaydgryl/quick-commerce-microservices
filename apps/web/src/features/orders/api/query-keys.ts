/**
 * Siparis sorgu anahtarlari. Kullanici kimligiyle anahtarlanir: ayni sekmede
 * baska hesapla giris yapilirsa onceki hesabin siparisleri gorunmez.
 */
export const orderKeys = {
  all: ['orders'] as const,
  history: (userId: string) => [...orderKeys.all, 'history', userId] as const,
  detail: (userId: string, orderId: string) =>
    [...orderKeys.all, 'detail', userId, orderId] as const,
};
