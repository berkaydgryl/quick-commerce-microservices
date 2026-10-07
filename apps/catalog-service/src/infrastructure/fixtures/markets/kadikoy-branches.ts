/**
 * Kadikoy'de var olan markalarin yeni subeleri (urun ve magaza cesitliligi,
 * 07.10). Ev adresine 0,9-1,7 km, karada (kiyidan uzak): listede eski
 * marketlerin ARDINDAN gelir, sira basi degismez. Logo markanin, kapak turun
 * mevcut gorseli. Carrefour Express - Kadikoy KAPALIDIR: Ev adresi de kapali
 * market gorur (her semtte bir tane).
 */

import type { Market } from '../../../domain/catalog.js';
import { STORE_TYPE } from '../../../domain/catalog.js';

export const KADIKOY_BRANCHES: readonly Market[] = [
  {
    id: 'mkt_bim-yeldegirmeni',
    name: 'BİM – Yeldeğirmeni',
    brand: 'BİM',
    logoUrl: '/img/market-logo/bim.svg',
    storeType: STORE_TYPE.MARKET,
    coverUrl: '/img/market/market.jpg',
    lat: 40.9965,
    lng: 29.03,
    deliveryRadiusMeters: 2500,
    isOpen: true,
    deliveryTime: { minMinutes: 25, maxMinutes: 35 },
    rating: { averageTenths: 42, count: 720 },
    pricingRules: {
      minBasketMinor: 10000,
      deliveryFeeMinor: 1990,
      freeDeliveryThresholdMinor: 25000,
    },
  },
  {
    // KAPALI, bilerek: Kadikoy'un STORE_CLOSED senaryosu (Abbasaga Besiktas'ta).
    id: 'mkt_carrefour-express-kadikoy',
    name: 'Carrefour Express – Kadıköy',
    brand: 'Carrefour Express',
    logoUrl: '/img/market-logo/carrefour-express.svg',
    storeType: STORE_TYPE.MARKET,
    coverUrl: '/img/market/market.jpg',
    lat: 40.9975,
    lng: 29.0215,
    deliveryRadiusMeters: 2500,
    isOpen: false,
    deliveryTime: { minMinutes: 20, maxMinutes: 35 },
    rating: { averageTenths: 43, count: 390 },
    pricingRules: {
      minBasketMinor: 7500,
      deliveryFeeMinor: 2990,
      freeDeliveryThresholdMinor: 25000,
    },
  },
  {
    id: 'mkt_a101-hasanpasa',
    name: 'A101 – Hasanpaşa',
    brand: 'A101',
    logoUrl: '/img/market-logo/a101.svg',
    storeType: STORE_TYPE.MARKET,
    coverUrl: '/img/market/market.jpg',
    lat: 40.9925,
    lng: 29.0395,
    deliveryRadiusMeters: 2500,
    isOpen: true,
    deliveryTime: { minMinutes: 20, maxMinutes: 30 },
    rating: { averageTenths: 43, count: 540 },
    pricingRules: {
      minBasketMinor: 10000,
      deliveryFeeMinor: 1990,
      freeDeliveryThresholdMinor: 25000,
    },
  },
  {
    id: 'mkt_sok-feneryolu',
    name: 'ŞOK – Feneryolu',
    brand: 'ŞOK',
    logoUrl: '/img/market-logo/sok.svg',
    storeType: STORE_TYPE.MARKET,
    coverUrl: '/img/market/market.jpg',
    lat: 40.9815,
    lng: 29.0445,
    deliveryRadiusMeters: 2500,
    isOpen: true,
    deliveryTime: { minMinutes: 25, maxMinutes: 35 },
    rating: { averageTenths: 44, count: 610 },
    pricingRules: {
      minBasketMinor: 7500,
      deliveryFeeMinor: 1990,
      freeDeliveryThresholdMinor: 25000,
    },
  },
  {
    id: 'mkt_kardesler-manavi-hasanpasa',
    name: 'Kardeşler Manavı – Hasanpaşa',
    brand: 'Kardeşler Manavı',
    logoUrl: '/img/market-logo/kardesler-manavi.svg',
    storeType: STORE_TYPE.MANAV,
    coverUrl: '/img/market/manav.jpg',
    lat: 40.995,
    lng: 29.044,
    deliveryRadiusMeters: 2000,
    isOpen: true,
    deliveryTime: { minMinutes: 15, maxMinutes: 25 },
    rating: { averageTenths: 47, count: 830 },
    pricingRules: {
      minBasketMinor: 6000,
      deliveryFeeMinor: 1490,
      freeDeliveryThresholdMinor: 20000,
    },
  },
  {
    id: 'mkt_bahariye-firini-yeldegirmeni',
    name: 'Bahariye Fırını – Yeldeğirmeni',
    brand: 'Bahariye Fırını',
    logoUrl: '/img/market-logo/bahariye-firini.svg',
    storeType: STORE_TYPE.FIRIN,
    coverUrl: '/img/market/firin.jpg',
    lat: 40.9958,
    lng: 29.0335,
    deliveryRadiusMeters: 2000,
    isOpen: true,
    deliveryTime: { minMinutes: 15, maxMinutes: 25 },
    rating: { averageTenths: 48, count: 420 },
    pricingRules: {
      minBasketMinor: 5000,
      deliveryFeeMinor: 990,
      freeDeliveryThresholdMinor: 15000,
    },
  },
];
