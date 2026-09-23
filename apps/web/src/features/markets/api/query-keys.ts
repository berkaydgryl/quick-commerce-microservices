import type { GeoPoint } from '@getir/contracts';

/** Market sorgu anahtarlari tek yerde: gecersiz kilma ayni diziyi kullanir. */
export const marketKeys = {
  all: ['markets'] as const,
  nearby: (location: GeoPoint) =>
    [...marketKeys.all, 'nearby', location.lat, location.lng] as const,
  detail: (marketId: string) => [...marketKeys.all, 'detail', marketId] as const,
};
