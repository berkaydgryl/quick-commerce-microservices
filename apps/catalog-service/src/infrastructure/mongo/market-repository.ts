import type { GeoPoint } from '@getir/core';
import type { Db, Document, IndexDescription } from 'mongodb';

import type { Market } from '../../domain/catalog.js';
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

/**
 * Konumu kapsayan marketler (#175): $geoNear 2dsphere indeksiyle yakindan
 * uzaga akitir (ilk asama olmak ZORUNDA), $match her marketi KENDI yaricapiyla
 * suzer (sinir dahil: @getir/core isOutsideDeliveryRadius'un tersi, $lte; Mongo
 * TS cagiramaz, use-case ayrica coveringMarkets'ten gecirir ve sozlesme testi iki
 * modu karsilastirir), $limit kapsayanlara uygulanir.
 *
 * maxDistance VERILMEZ: yaricap markete gore degisir ve sozlesmede ust sinir
 * yok. Bedeli: `limit` kadar kapsayan bulunursa okuma orada durur; daha azi
 * kapsiyorsa indeks butun marketleri yakindan uzaga gezer (bugun 33 market).
 */
export function coveringMarketsPipeline(point: GeoPoint, limit: number): Document[] {
  return [
    {
      $geoNear: {
        // GeoJSON sirasi: [BOYLAM, ENLEM].
        near: { type: 'Point', coordinates: [point.lng, point.lat] },
        distanceField: 'distanceMeters',
        spherical: true,
      },
    },
    { $match: { $expr: { $lte: ['$distanceMeters', '$deliveryRadiusMeters'] } } },
    { $limit: limit },
  ];
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

  /** Tek sorgu, _id indeksiyle ($in): favori sayfasi market basina sorgu atmaz (T11.13). */
  async findMarketsByIds(marketIds: readonly string[]): Promise<readonly Market[]> {
    if (marketIds.length === 0) {
      return [];
    }
    const documents = await this.run('findMarketsByIds', () =>
      this.collection.find({ _id: { $in: [...marketIds] } }).toArray(),
    );
    return documents.map(fromMarketDocument);
  }

  /** Konumu kapsayan marketler, yakindan uzaga, en fazla `limit` (coveringMarketsPipeline). */
  async listCoveringMarkets(point: GeoPoint, limit: number): Promise<readonly MarketDistance[]> {
    const documents = await this.run('listCoveringMarkets', () =>
      this.collection
        .aggregate<MarketWithDistance>(coveringMarketsPipeline(point, limit))
        .toArray(),
    );

    return documents.map(({ distanceMeters, ...document }) => ({
      market: fromMarketDocument(document),
      distanceMeters,
    }));
  }
}
