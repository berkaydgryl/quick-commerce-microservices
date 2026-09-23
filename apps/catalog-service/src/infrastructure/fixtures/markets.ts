/**
 * Demo verisi: iki semtte 6 market, her birinin kendi kurallariyla (ADR-15).
 * Degerler docs/roadmap.md "Pazaryeri demo verisi" tablosuyla birebir.
 * Konumlar infra/seed/data/addresses.json'daki Ev (Kadikoy) ve Is (Besiktas)
 * adreslerinin yaricapi icindedir; Yazlik (Sile) hicbirinin icinde degil.
 */

import type { Market } from '../../domain/catalog.js';

export const MARKETS: readonly Market[] = [
  {
    id: 'mkt_migros-jet-moda',
    name: 'Migros Jet – Moda',
    brand: 'Migros Jet',
    logoUrl: '/img/market/migros-jet.png',
    lat: 40.985,
    lng: 29.0275,
    deliveryRadiusMeters: 2500,
    isOpen: true,
    deliveryTime: { minMinutes: 15, maxMinutes: 25 },
    rating: { averageTenths: 47, count: 1200 },
    pricingRules: {
      minBasketMinor: 4000,
      deliveryFeeMinor: 2490,
      freeDeliveryThresholdMinor: 30000,
    },
  },
  {
    id: 'mkt_a101-caferaga',
    name: 'A101 – Caferağa',
    brand: 'A101',
    logoUrl: '/img/market/a101.png',
    lat: 40.9895,
    lng: 29.024,
    deliveryRadiusMeters: 2000,
    isOpen: true,
    deliveryTime: { minMinutes: 20, maxMinutes: 30 },
    rating: { averageTenths: 43, count: 860 },
    pricingRules: {
      minBasketMinor: 10000,
      deliveryFeeMinor: 1990,
      freeDeliveryThresholdMinor: 25000,
    },
  },
  {
    id: 'mkt_kardesler-manavi',
    name: 'Kardeşler Manavı',
    brand: 'Kardeşler Manavı',
    logoUrl: '/img/market/kardesler-manavi.png',
    lat: 40.9905,
    lng: 29.029,
    deliveryRadiusMeters: 1500,
    isOpen: true,
    deliveryTime: { minMinutes: 10, maxMinutes: 20 },
    rating: { averageTenths: 48, count: 1500 },
    pricingRules: {
      minBasketMinor: 6000,
      deliveryFeeMinor: 1490,
      freeDeliveryThresholdMinor: 20000,
    },
  },
  {
    id: 'mkt_migros-jet-besiktas',
    name: 'Migros Jet – Beşiktaş',
    brand: 'Migros Jet',
    logoUrl: '/img/market/migros-jet.png',
    lat: 41.0425,
    lng: 29.008,
    deliveryRadiusMeters: 2500,
    isOpen: true,
    deliveryTime: { minMinutes: 15, maxMinutes: 25 },
    rating: { averageTenths: 46, count: 980 },
    pricingRules: {
      minBasketMinor: 4000,
      deliveryFeeMinor: 2490,
      freeDeliveryThresholdMinor: 30000,
    },
  },
  {
    id: 'mkt_carrefour-express-barbaros',
    name: 'Carrefour Express – Barbaros',
    brand: 'Carrefour Express',
    logoUrl: '/img/market/carrefour-express.png',
    lat: 41.046,
    lng: 29.007,
    deliveryRadiusMeters: 2000,
    isOpen: true,
    deliveryTime: { minMinutes: 20, maxMinutes: 35 },
    rating: { averageTenths: 44, count: 640 },
    pricingRules: {
      minBasketMinor: 7500,
      deliveryFeeMinor: 2990,
      freeDeliveryThresholdMinor: 25000,
    },
  },
  {
    // KAPALI, bilerek: listede "Kapali" rozetiyle gorunur, siparis almaz (STORE_CLOSED).
    id: 'mkt_a101-abbasaga',
    name: 'A101 – Abbasağa',
    brand: 'A101',
    logoUrl: '/img/market/a101.png',
    lat: 41.045,
    lng: 29.002,
    deliveryRadiusMeters: 2000,
    isOpen: false,
    deliveryTime: { minMinutes: 20, maxMinutes: 30 },
    rating: { averageTenths: 42, count: 310 },
    pricingRules: {
      minBasketMinor: 10000,
      deliveryFeeMinor: 1990,
      freeDeliveryThresholdMinor: 25000,
    },
  },
];
