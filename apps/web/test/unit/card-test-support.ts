/** Kart testlerinin ortak ornekleri (T11.17): sozlesmeye uyan maskeli kartlar ve test numaralari. */

import type { SavedCard } from '@getir/contracts';

/** Saglayicinin test kartlari (Luhn ve marka gecerli). */
export const VISA_NUMBER = '4242424242424242';
export const AMEX_NUMBER = '378282246310005';
export const MASTERCARD_NUMBER = '5555555555554444';

export const VISA_CARD: SavedCard = {
  id: 'crd_00000000000000000000000000000001',
  brand: 'VISA',
  first4: '4242',
  last4: '4242',
  expiryMonth: 8,
  expiryYear: 2029,
  holderName: 'Ayşe Yılmaz',
  nickname: 'Maaş kartım',
  expired: false,
  createdAt: '2026-10-05T12:00:00.000Z',
};

export const EXPIRED_AMEX: SavedCard = {
  id: 'crd_00000000000000000000000000000002',
  brand: 'AMEX',
  first4: '3782',
  last4: '0005',
  expiryMonth: 1,
  expiryYear: 2024,
  holderName: 'Ayşe Yılmaz',
  expired: true,
  createdAt: '2026-10-01T12:00:00.000Z',
};
