import { describe, expect, it } from 'vitest';

import { distanceMeters, isOutsideDeliveryRadius } from '../../src/geo.js';

const KADIKOY = { lat: 40.9903, lng: 29.0275 };
const BESIKTAS = { lat: 41.0422, lng: 29.0093 };

describe('distanceMeters', () => {
  it('ayni nokta 0', () => {
    expect(distanceMeters(KADIKOY, KADIKOY)).toBe(0);
  });

  it('simetrik', () => {
    expect(distanceMeters(KADIKOY, BESIKTAS)).toBeCloseTo(distanceMeters(BESIKTAS, KADIKOY), 6);
  });

  it('bilinen mesafe: bir enlem derecesi ~111,3 km (2*pi*R/360, R = 6378,1 km)', () => {
    // Referans deger formulden bagimsiz dogrulanir: 2*pi*6_378_100/360.
    expect(distanceMeters({ lat: 40, lng: 29 }, { lat: 41, lng: 29 })).toBeCloseTo(111_319, -1);
  });

  it('Kadikoy - Besiktas deposu ~5,9 km', () => {
    expect(distanceMeters(KADIKOY, BESIKTAS)).toBeGreaterThan(5_800);
    expect(distanceMeters(KADIKOY, BESIKTAS)).toBeLessThan(6_000);
  });
});

describe('isOutsideDeliveryRadius', () => {
  it('sinir DAHIL: mesafe == yaricap disarida degil; 1 m fazlasi disarida', () => {
    expect(isOutsideDeliveryRadius(3_000, 3_000)).toBe(false);
    expect(isOutsideDeliveryRadius(2_999.9, 3_000)).toBe(false);
    expect(isOutsideDeliveryRadius(3_001, 3_000)).toBe(true);
  });

  it('NaN disarida SAYILMAZ (catalog\'un ilk yazimiyla ayni; veriyi cagiran dogrular)', () => {
    expect(isOutsideDeliveryRadius(Number.NaN, 3_000)).toBe(false);
    expect(isOutsideDeliveryRadius(3_001, Number.NaN)).toBe(false);
  });
});
