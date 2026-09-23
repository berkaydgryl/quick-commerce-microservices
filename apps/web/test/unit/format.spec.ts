import { describe, expect, it } from 'vitest';

import {
  formatDeliveryTime,
  formatDistance,
  formatMoney,
  formatRating,
} from '../../src/shared/services/format';

describe('format', () => {
  it('parayi kurustan TL gosterimine cevirir (float hesabi yok)', () => {
    expect(formatMoney({ amountMinor: 4599, currency: 'TRY' })).toBe('45,99 TL');
    expect(formatMoney({ amountMinor: 4000, currency: 'TRY' })).toBe('40,00 TL');
    expect(formatMoney({ amountMinor: 5, currency: 'TRY' })).toBe('0,05 TL');
    expect(formatMoney({ amountMinor: 123_456, currency: 'TRY' })).toBe('1.234,56 TL');
  });

  it('mesafeyi 1 km altinda metre, ustunde km gosterir', () => {
    expect(formatDistance(405)).toBe('405 m');
    expect(formatDistance(1000)).toBe('1 km');
    expect(formatDistance(1250)).toBe('1,3 km');
  });

  it('teslimat araligini dakika olarak gosterir', () => {
    expect(formatDeliveryTime({ minMinutes: 15, maxMinutes: 25 })).toBe('15-25 dk');
    expect(formatDeliveryTime({ minMinutes: 20, maxMinutes: 20 })).toBe('20 dk');
  });

  it('puani tek ondalikla ve Turkce ayracla gosterir', () => {
    expect(formatRating(4.7)).toBe('4,7');
    expect(formatRating(5)).toBe('5,0');
  });
});
