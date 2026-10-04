/**
 * Seed'in tek kurye satiri ve ondan kurye uretimi: saf, I/O yok. Seed edilen
 * kurye IDLE baslar, bosta beklemesi seed aninda baslar; hic atanmamistir.
 */

import { COURIER_STATUS } from './courier.js';
import type { Courier, GeoPoint } from './courier.js';

export interface CourierSeed {
  readonly id: string;
  readonly name: string;
  /** Baslangic konumu: bir marketin yakini (fixtures). */
  readonly location: GeoPoint;
}

export function courierFromSeed(seed: CourierSeed, at: Date): Courier {
  return {
    id: seed.id,
    name: seed.name,
    status: COURIER_STATUS.IDLE,
    idleSince: at,
    lastLocation: seed.location,
    lastLocationAt: at,
  };
}
