/**
 * 3 demo adresi - TEK KAYNAK: apps/gateway/internal/persona/addresses.json
 * (sahibi gateway, users.addresses[]; T8.1'e kadar infra/seed/data'daydi).
 *
 * Onceki surumde koordinatlar dort yerde elle yaziliydi (JSON, sozlesme testi,
 * use-case testi, gRPC testi); biri degisince digerleri sessizce eskirdi.
 * Dosya sozlesmedeki savedAddressSchema (kayitli adres) ile dogrulanarak okunur (ADR-10).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { savedAddressSchema } from '@getir/contracts';
import type { SavedAddress } from '@getir/contracts';
import { z } from 'zod';

import type { GeoPoint } from '../../src/domain/geo.js';

const ADDRESSES_PATH = fileURLToPath(
  new URL('../../../gateway/internal/persona/addresses.json', import.meta.url),
);

export const DEMO_ADDRESSES: readonly SavedAddress[] = z
  .array(savedAddressSchema)
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
    // T11.11: dukkan turleri; ilk ucunden uzak (sira basi degismez).
    { marketId: 'mkt_sok-moda', meters: 459 },
    { marketId: 'mkt_moda-kasabi', meters: 519 },
    { marketId: 'mkt_moda-sarkuteri', meters: 581 },
    { marketId: 'mkt_altiyol-kuruyemis', meters: 640 },
    { marketId: 'mkt_bahariye-firini', meters: 697 },
    { marketId: 'mkt_pati-pet-shop-kadikoy', meters: 785 },
    { marketId: 'mkt_moda-cicekcilik', meters: 854 },
  ],
  İş: [
    { marketId: 'mkt_migros-jet-besiktas', meters: 101 },
    { marketId: 'mkt_carrefour-express-barbaros', meters: 323 },
    // KAPALI: listede kalir ("Kapali" rozeti).
    { marketId: 'mkt_a101-abbasaga', meters: 478 },
    // T11.11: dukkan turleri; ilk ucunden uzak (sira basi degismez).
    { marketId: 'mkt_bim-sinanpasa', meters: 519 },
    { marketId: 'mkt_carsi-manavi', meters: 581 },
    { marketId: 'mkt_barbaros-kasabi', meters: 635 },
    { marketId: 'mkt_besiktas-sarkuteri', meters: 698 },
    { marketId: 'mkt_yildiz-kuruyemis', meters: 758 },
    { marketId: 'mkt_abbasaga-firini', meters: 819 },
    { marketId: 'mkt_pati-pet-shop-besiktas', meters: 877 },
    { marketId: 'mkt_lale-cicekcilik', meters: 947 },
  ],
  Yazlık: [],
} as const satisfies Record<DemoAddressTitle, readonly { marketId: string; meters: number }[]>;
