/**
 * Seed'in tek kurye satiri ve ondan kurye uretimi: saf, I/O yok. Seed edilen
 * kurye IDLE ve marketinin konumunda baslar; hic atanmamistir.
 */

import { COURIER_STATUS } from './courier.js';
import type { Courier, GeoPoint } from './courier.js';

export interface CourierSeed {
  readonly id: string;
  readonly name: string;
  readonly marketId: string;
  /** Baslangic konumu: marketin konumu. */
  readonly location: GeoPoint;
}

export function courierFromSeed(seed: CourierSeed, at: Date): Courier {
  return {
    id: seed.id,
    name: seed.name,
    marketId: seed.marketId,
    status: COURIER_STATUS.IDLE,
    lastLocation: seed.location,
    lastLocationAt: at,
  };
}
