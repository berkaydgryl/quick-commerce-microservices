import type { Db, IndexDescription } from 'mongodb';

import type { Market } from '../../domain/catalog.js';
import type { GeoPoint } from '../../domain/geo.js';
import type { MarketDistance } from '../../domain/market-coverage.js';
import type { MarketReader } from '../../domain/market-reader.js';
import type { MarketDocument } from './documents.js';
import { COLLECTIONS } from './documents.js';
import { fromMarketDocument } from './mappers.js';
import { ReplaceableRepository } from './replaceable-repository.js';

/** $geoNear'in belgeye ekledigi mesafe alani. */
interface MarketWithDistance extends MarketDocument {
  distanceMeters: number;
}

export class MarketRepository
  extends ReplaceableRepository<MarketDocument>
  implements MarketReader
{
  constructor(db: Db) {
    super(db, COLLECTIONS.MARKETS);
  }

  protected override indexes(): readonly IndexDescription[] {
    // $geoNear 2dsphere indeksi olmadan HATA verir, yavaslamaz.
    return [{ key: { location: '2dsphere' }, name: 'location_2dsphere' }];
  }

  async getMarket(marketId: string): Promise<Market | null> {
    const document = await this.findById(marketId);
    return document === null ? null : fromMarketDocument(document);
  }

  async marketExists(marketId: string): Promise<boolean> {
    return this.exists({ _id: marketId });
  }

  /**
   * Konuma en yakin marketler, yakindan uzaga (T4.2'nin sorgusu).
   *
   * maxDistance VERILMEZ: yaricap markete gore degisir; kapsama karari
   * domain'dedir (coveringMarkets).
   */
  async listMarketsByDistance(point: GeoPoint, limit: number): Promise<readonly MarketDistance[]> {
    const documents = await this.run('listMarketsByDistance', () =>
      this.collection
        .aggregate<MarketWithDistance>([
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
      market: fromMarketDocument(document),
      distanceMeters,
    }));
  }
}
