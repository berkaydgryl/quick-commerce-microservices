/**
 * 3 demo adresi - TEK KAYNAK: infra/seed/data/addresses.json.
 *
 * Onceki surumde koordinatlar dort yerde elle yaziliydi (JSON, sozlesme testi,
 * use-case testi, gRPC testi); biri degisince digerleri sessizce eskirdi.
 * Dosya sozlesmedeki deliveryAddressSchema ile dogrulanarak okunur (ADR-10).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { deliveryAddressSchema } from '@getir/contracts';
import type { DeliveryAddress } from '@getir/contracts';
import { z } from 'zod';

import type { GeoPoint } from '../../src/domain/geo.js';

const ADDRESSES_PATH = fileURLToPath(
  new URL('../../../../infra/seed/data/addresses.json', import.meta.url),
);

export const DEMO_ADDRESSES: readonly DeliveryAddress[] = z
  .array(deliveryAddressSchema)
  .parse(JSON.parse(readFileSync(ADDRESSES_PATH, 'utf8')));

export type DemoAddressTitle = 'Ev' | 'İş' | 'Yazlık';

/** Basliga gore adresin konumu; yoksa test kurulumu hatalidir. */
export function demoLocation(title: DemoAddressTitle): GeoPoint {
  const address = DEMO_ADDRESSES.find((candidate) => candidate.title === title);
  if (address === undefined) {
    throw new Error(`demo adresi yok: ${title}`);
  }
  return address.location;
}

/**
 * Adrese hizmet veren marketler ve mesafeleri (metre, yuvarlanmis), YAKINDAN
 * UZAGA. Haversine ile MongoDB'nin ekvator yaricapiyla olculdu; Mongo $geoNear
 * ile +-1 m icinde esit oldugu sozlesme testinde olculur.
 */
export const EXPECTED_NEARBY = {
  Ev: [
    { marketId: 'mkt_a101-caferaga', meters: 216 },
    { marketId: 'mkt_kardesler-manavi', meters: 324 },
    { marketId: 'mkt_migros-jet-moda', meters: 405 },
  ],
  İş: [
    { marketId: 'mkt_migros-jet-besiktas', meters: 101 },
    { marketId: 'mkt_carrefour-express-barbaros', meters: 323 },
    // KAPALI: listede kalir ("Kapali" rozeti).
    { marketId: 'mkt_a101-abbasaga', meters: 478 },
  ],
  Yazlık: [],
} as const satisfies Record<DemoAddressTitle, readonly { marketId: string; meters: number }[]>;
