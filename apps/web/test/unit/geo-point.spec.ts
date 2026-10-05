/**
 * Iki noktanin ayni sayilmasi (T11.15): harita merkezinin geri okunusundaki
 * kucuk kayma ayni nokta; ~1 m'den buyuk fark degil.
 */

import { describe, expect, it } from 'vitest';

import { isSamePoint, SAME_POINT_TOLERANCE } from '../../src/features/address/services/geo-point';

const NOKTA = { lat: 40.9885, lng: 29.0262 };

describe('isSamePoint', () => {
  it('ayni nokta ve izdusum kaymasi ayni sayilir', () => {
    expect(isSamePoint(NOKTA, NOKTA)).toBe(true);
    expect(isSamePoint(NOKTA, { lat: NOKTA.lat + 1e-9, lng: NOKTA.lng - 1e-9 })).toBe(true);
  });

  it('toleranstan buyuk fark (enlem ya da boylam) baska noktadir', () => {
    expect(isSamePoint(NOKTA, { lat: NOKTA.lat + SAME_POINT_TOLERANCE * 2, lng: NOKTA.lng })).toBe(
      false,
    );
    expect(isSamePoint(NOKTA, { lat: NOKTA.lat, lng: NOKTA.lng + 0.001 })).toBe(false);
  });
});
