/**
 * Iki nokta ayni mi (T11.15): SAF kural. Harita merkezi geri okununca
 * (getCenter) izdusumden kucuk kaymalar olur; 1e-5 derece (~1 m) icindeki
 * fark ayni nokta sayilir. Harita disaridan gelen noktaya bu yuzden yeniden
 * gitmez; duzenlemede nokta degismediyse adresin satiri korunur.
 */

import type { GeoPoint } from '@getir/contracts';

export const SAME_POINT_TOLERANCE = 1e-5;

export function isSamePoint(a: GeoPoint, b: GeoPoint): boolean {
  return (
    Math.abs(a.lat - b.lat) < SAME_POINT_TOLERANCE && Math.abs(a.lng - b.lng) < SAME_POINT_TOLERANCE
  );
}
