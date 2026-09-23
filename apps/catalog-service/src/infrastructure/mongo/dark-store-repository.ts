import type { Db, IndexDescription } from 'mongodb';

import type { DarkStoreReader } from '../../domain/dark-store-reader.js';
import type { StoreDistance } from '../../domain/dark-store-resolution.js';
import type { GeoPoint } from '../../domain/geo.js';
import type { DarkStoreDocument } from './documents.js';
import { COLLECTIONS } from './documents.js';
import { fromDarkStoreDocument } from './mappers.js';
import { ReplaceableRepository } from './replaceable-repository.js';

/** $geoNear'in belgeye ekledigi mesafe alani. */
interface DarkStoreWithDistance extends DarkStoreDocument {
  distanceMeters: number;
}

export class DarkStoreRepository
  extends ReplaceableRepository<DarkStoreDocument>
  implements DarkStoreReader
{
  constructor(db: Db) {
    super(db, COLLECTIONS.DARK_STORES);
  }

  protected override indexes(): readonly IndexDescription[] {
    // ResolveDarkStore (T4.2) "bu konuma en yakin depo" sorgusunu $near ile
    // yapar; $near 2dsphere indeksi olmadan HATA verir, yavaslamaz.
    return [{ key: { location: '2dsphere' }, name: 'location_2dsphere' }];
  }

  async darkStoreExists(darkStoreId: string): Promise<boolean> {
    return this.exists({ _id: darkStoreId });
  }

  /**
   * Konuma en yakin depolar, yakindan uzaga.
   *
   * $geoNear, GeoJSON noktalarda mesafeyi METRE olarak verir ve sonucu
   * kendisi siralar; boru hattinin ILK asamasi olmak zorundadir ve
   * location_2dsphere indeksine dayanir. maxDistance VERILMEZ: yaricap depoya
   * gore degisir ve "en yakin depo X km uzakta" bilgisi icin kapsama disindaki
   * en yakin depo da gerekir. Yaricap karari domain'dedir.
   */
  async listDarkStoresByDistance(
    point: GeoPoint,
    limit: number,
  ): Promise<readonly StoreDistance[]> {
    const documents = await this.run('listDarkStoresByDistance', () =>
      this.collection
        .aggregate<DarkStoreWithDistance>([
          {
            $geoNear: {
              // GeoJSON sirasi: [BOYLAM, ENLEM].
              near: { type: 'Point', coordinates: [point.lng, point.lat] },
              distanceField: 'distanceMeters',
              spherical: true,
            },
          },
          { $limit: limit },
        ])
        .toArray(),
    );

    return documents.map(({ distanceMeters, ...document }) => ({
      store: fromDarkStoreDocument(document),
      distanceMeters,
    }));
  }
}
