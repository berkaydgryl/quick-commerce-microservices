import type { DarkStore } from '../../domain/catalog.js';
import type { DarkStoreReader } from '../../domain/dark-store-reader.js';
import type { StoreDistance } from '../../domain/dark-store-resolution.js';
import type { GeoPoint } from '../../domain/geo.js';
import { distanceMeters } from '../../domain/geo.js';

export class InMemoryDarkStoreReader implements DarkStoreReader {
  private readonly stores: readonly DarkStore[];
  private readonly ids: ReadonlySet<string>;

  constructor(stores: readonly DarkStore[]) {
    this.stores = stores;
    this.ids = new Set(stores.map((store) => store.id));
  }

  darkStoreExists(darkStoreId: string): Promise<boolean> {
    return Promise.resolve(this.ids.has(darkStoreId));
  }

  /** Mongo'daki $geoNear'in karsiligi: mesafe hesabi + siralama + sinir. */
  listDarkStoresByDistance(point: GeoPoint, limit: number): Promise<readonly StoreDistance[]> {
    const ranked = this.stores
      .map((store) => ({ store, distanceMeters: distanceMeters(point, store) }))
      .sort((left, right) => left.distanceMeters - right.distanceMeters)
      .slice(0, limit);
    return Promise.resolve(ranked);
  }
}
