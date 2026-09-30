import type { GeoPoint } from '@getir/contracts';

/** Market sorgu anahtarlari tek yerde: gecersiz kilma ayni diziyi kullanir. */
export const marketKeys = {
  all: ['markets'] as const,
  /** Konum yoksa null (teslimat adresi cozuluyor, T9.5): hicbir konumun girdisiyle karismaz. */
  nearby: (location: GeoPoint | undefined) =>
    [...marketKeys.all, 'nearby', location?.lat ?? null, location?.lng ?? null] as const,
  detail: (marketId: string) => [...marketKeys.all, 'detail', marketId] as const,
};
