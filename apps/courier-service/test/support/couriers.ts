/** Testlerin kurye ve kimlik ureticileri. Kimlikler sozlesme bicimindedir (crr_/ord_ + 32 hex). */

import { ID_PREFIX, newId } from '@getir/core';

import { COURIER_STATUS } from '../../src/domain/courier.js';
import type { Courier } from '../../src/domain/courier.js';

export const MARKET = 'mkt_migros-jet-moda';
export const OTHER_MARKET = 'mkt_a101-caferaga';

export const SEEDED_AT = new Date('2026-10-04T08:00:00.000Z');
export const NOW_MS = Date.parse('2026-10-04T09:00:00.000Z');

/** Sirali kurye kimligi: sozlugsel sira numarayla ayni (esitlik kurali testleri). */
export function courierId(order: number): string {
  return `${ID_PREFIX.COURIER}_${order.toString(16).padStart(32, '0')}`;
}

export const orderId = (): string => newId(ID_PREFIX.ORDER);

export function courier(order: number, fields: Partial<Courier> = {}): Courier {
  return {
    id: courierId(order),
    name: `Kurye ${order}`,
    marketId: MARKET,
    status: COURIER_STATUS.IDLE,
    lastLocation: { lat: 40.985, lng: 29.0275 },
    lastLocationAt: SEEDED_AT,
    ...fields,
  };
}

export const DELIVERY = { lat: 40.99, lng: 29.03 } as const;
