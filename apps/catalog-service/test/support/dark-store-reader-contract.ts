/**
 * DarkStoreReader SOZLESME testi: ayni senaryolar bellekte (unit) ve gercek
 * Mongo'da (integration) kosar. MOCK modu ile gercek mod ayni depoyu, ayni
 * mesafeyi (+-1 m) gostermeli.
 *
 * Kapali depo senaryosu BURADA DEGIL: demo verisinde iki depo da acik.
 * Okuyucunun kapali depoyu filtrelemedigi, kendi verisiyle ayrica sinanir
 * (unit: in-memory-readers.spec.ts, integration: mongo-catalog.spec.ts).
 */

import { describe, expect, it } from 'vitest';

import type { DarkStoreReader } from '../../src/domain/dark-store-reader.js';
import type { DemoAddressTitle } from './demo-addresses.js';
import { demoLocation, EXPECTED_NEAREST } from './demo-addresses.js';

/** Iki deponun tamami: siralamayi gormek icin sinir yeterince genis. */
const ALL_STORES = 5;

export function describeDarkStoreReaderContract(
  name: string,
  getReader: () => DarkStoreReader,
): void {
  describe(`DarkStoreReader sozlesmesi: ${name}`, () => {
    const titles: DemoAddressTitle[] = ['Ev', 'İş', 'Yazlık'];

    it.each(titles)('%s: en yakin depo ve mesafesi (metre, +-1)', async (title) => {
      const [nearest] = await getReader().listDarkStoresByDistance(demoLocation(title), ALL_STORES);
      const expected = EXPECTED_NEAREST[title];

      expect(nearest?.store.id).toBe(expected.storeId);
      expect(
        Math.abs((nearest?.distanceMeters ?? Number.NaN) - expected.meters),
      ).toBeLessThanOrEqual(1);
    });

    it('yakindan uzaga siralanir', async () => {
      const ranked = await getReader().listDarkStoresByDistance(demoLocation('İş'), ALL_STORES);

      expect(ranked.map((entry) => entry.store.id)).toEqual(['ds_besiktas', 'ds_kadikoy']);
      const distances = ranked.map((entry) => entry.distanceMeters);
      expect(distances).toEqual([...distances].sort((left, right) => left - right));
    });

    it('limit uygulanir', async () => {
      const ranked = await getReader().listDarkStoresByDistance(demoLocation('Ev'), 1);

      expect(ranked).toHaveLength(1);
    });

    it('depo varligi', async () => {
      const reader = getReader();

      expect(await reader.darkStoreExists('ds_kadikoy')).toBe(true);
      expect(await reader.darkStoreExists('ds_besiktas')).toBe(true);
      expect(await reader.darkStoreExists('ds_yok')).toBe(false);
    });
  });
}
