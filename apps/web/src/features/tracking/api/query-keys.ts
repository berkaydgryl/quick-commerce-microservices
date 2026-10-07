/**
 * Kurye takibi sorgu anahtarlari: kullanici kimligiyle (ayni sekmede baska
 * hesapla giriste onceki hesabin takibi gorunmez).
 */
export const trackingKeys = {
  all: ['tracking'] as const,
  order: (userId: string, orderId: string) => [...trackingKeys.all, userId, orderId] as const,
};
