/**
 * Use-case: sonucun sozlesme bicimine cevrilmesi. Bellek deposu ile, kendi
 * test verisiyle (kapali depo senaryosu demo verisinde yok - iki depo da acik).
 */

import { AppError, ERROR_CODES } from '@getir/core';
import { describe, expect, it } from 'vitest';

import {
  createResolveDarkStore,
  NO_STORE_DETAIL,
  NO_STORE_REASON,
} from '../../src/application/resolve-dark-store.js';
import type { CatalogSnapshot } from '../../src/domain/catalog-snapshot.js';
import { CATALOG_SNAPSHOT } from '../../src/infrastructure/fixtures.js';
import { createInMemoryReaders } from '../../src/infrastructure/memory/in-memory-catalog.js';
import { demoLocation, EXPECTED_NEAREST } from '../support/demo-addresses.js';

const EV = demoLocation('Ev');
const YAZLIK = demoLocation('Yazlık');

function withSnapshot(snapshot: CatalogSnapshot) {
  return createResolveDarkStore({ darkStores: createInMemoryReaders(snapshot).darkStores });
}

async function noStoreDetails(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ERROR_CODES.NO_STORE);
    return (error as AppError).details;
  }
  throw new Error('NO_STORE bekleniyordu');
}

describe('resolveDarkStore use-case', () => {
  it('bulunan depo ve yuvarlanmis mesafe', async () => {
    const resolved = await withSnapshot(CATALOG_SNAPSHOT)(EV);

    expect(resolved.store.id).toBe('ds_kadikoy');
    expect(resolved.distanceMeters).toBe(EXPECTED_NEAREST.Ev.meters);
    expect(Number.isInteger(resolved.distanceMeters)).toBe(true);
  });

  it('yaricap disi: NO_STORE, reason OUT_OF_RANGE, mesafe METIN', async () => {
    const details = await noStoreDetails(withSnapshot(CATALOG_SNAPSHOT)(YAZLIK));

    // Ayrinti string->string: proto ErrorDetail.metadata ile ayni bicim.
    expect(details).toEqual({
      [NO_STORE_DETAIL.REASON]: NO_STORE_REASON.OUT_OF_RANGE,
      [NO_STORE_DETAIL.NEAREST_DISTANCE_METERS]: String(EXPECTED_NEAREST.Yazlık.meters),
    });
  });

  it('kapsayan depo kapali: NO_STORE, reason STORE_CLOSED', async () => {
    const closed: CatalogSnapshot = {
      ...CATALOG_SNAPSHOT,
      darkStores: CATALOG_SNAPSHOT.darkStores.map((candidate) =>
        candidate.id === 'ds_kadikoy' ? { ...candidate, isOpen: false } : candidate,
      ),
    };

    const details = await noStoreDetails(withSnapshot(closed)(EV));

    expect(details).toEqual({
      [NO_STORE_DETAIL.REASON]: NO_STORE_REASON.STORE_CLOSED,
      [NO_STORE_DETAIL.NEAREST_DISTANCE_METERS]: String(EXPECTED_NEAREST.Ev.meters),
    });
  });

  it('katalogda hic depo yoksa NO_STORE, mesafe yok', async () => {
    const details = await noStoreDetails(withSnapshot({ ...CATALOG_SNAPSHOT, darkStores: [] })(EV));

    expect(details).toEqual({ [NO_STORE_DETAIL.REASON]: NO_STORE_REASON.NO_STORES });
  });
});
