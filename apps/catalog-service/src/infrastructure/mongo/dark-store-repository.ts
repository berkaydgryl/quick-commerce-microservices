import type { Db, IndexDescription } from 'mongodb';

import type { DarkStoreDocument } from './documents.js';
import { COLLECTIONS } from './documents.js';
import { ReplaceableRepository } from './replaceable-repository.js';

export class DarkStoreRepository extends ReplaceableRepository<DarkStoreDocument> {
  constructor(db: Db) {
    super(db, COLLECTIONS.DARK_STORES);
  }

  protected override indexes(): readonly IndexDescription[] {
    // ResolveDarkStore (T4.2) "bu konuma en yakin depo" sorgusunu $near ile
    // yapar; $near 2dsphere indeksi olmadan HATA verir, yavaslamaz.
    return [{ key: { location: '2dsphere' }, name: 'location_2dsphere' }];
  }

  async existsById(id: string): Promise<boolean> {
    return this.exists({ _id: id });
  }
}
