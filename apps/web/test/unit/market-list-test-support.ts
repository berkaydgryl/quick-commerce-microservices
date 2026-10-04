/** Market listesi testlerinin ortak parcalari (T11.12): sozlesmeye uyan yakindaki market. */

import type { NearbyMarket, StoreType } from '@getir/contracts';

const TRY = (amountMinor: number) => ({ amountMinor, currency: 'TRY' as const });

interface MarketOptions {
  readonly id: string;
  readonly name: string;
  readonly brand: string;
  readonly storeType?: StoreType;
  readonly isOpen?: boolean;
  readonly meters: number;
}

export function nearbyMarket({
  id,
  name,
  brand,
  storeType,
  isOpen = true,
  meters,
}: MarketOptions): NearbyMarket {
  return {
    market: {
      id,
      name,
      brand,
      ...(storeType === undefined ? {} : { storeType }),
      coverUrl: 'https://cdn.example.com/img/market/market.jpg',
      location: { lat: 40.99, lng: 29.03 },
      deliveryRadiusMeters: 2000,
      isOpen,
      deliveryTime: { minMinutes: 15, maxMinutes: 25 },
      rating: { average: 4.7, count: 1200 },
      pricingRules: {
        minBasket: TRY(4000),
        deliveryFee: TRY(2490),
        freeDeliveryThreshold: TRY(30000),
      },
    },
    distanceMeters: meters,
  };
}

/** Ev adresinin yakinindaki bir kesit: iki market, bir kasap, bir kapali market, bir turu bilinmeyen. */
export const NEARBY: readonly NearbyMarket[] = [
  nearbyMarket({
    id: 'mkt_a101-caferaga',
    name: 'A101 – Caferağa',
    brand: 'A101',
    storeType: 'MARKET',
    meters: 216,
  }),
  nearbyMarket({
    id: 'mkt_moda-kasabi',
    name: 'Moda Kasabı',
    brand: 'Moda Kasabı',
    storeType: 'KASAP',
    meters: 405,
  }),
  nearbyMarket({
    id: 'mkt_migros-jet-moda',
    name: 'Migros Jet – Moda',
    brand: 'Migros Jet',
    storeType: 'MARKET',
    isOpen: false,
    meters: 519,
  }),
  nearbyMarket({ id: 'mkt_eski-surum', name: 'Eski Sürüm Market', brand: 'Eski', meters: 700 }),
];
