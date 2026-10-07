/**
 * couriers sorgulari ve indeksleri: yalnizca BELGE okur-yazar. Koleksiyonun
 * TEK sahibi courier-service'tir (ADR-05); order kuryeyi RPC ile ister.
 */

import { MongoRepository } from '@getir/mongo-kit';
import type { SessionOption } from '@getir/mongo-kit';
import type { Db, IndexDescription } from 'mongodb';

import { COURIER_STATUS } from '../../domain/courier.js';
import type { GeoPoint } from '../../domain/courier.js';
import type { PoolRule } from '../../domain/courier-pool.js';
import type { CourierDocument } from './documents.js';
import { COLLECTIONS } from './documents.js';
import { toGeoJson } from './mappers.js';

/**
 * Havuz sirasi (domain/courier-pool.ts ile ayni): yakinlik dilimi, sonra bosta
 * bekleme baslangici (eksik alan tarihlerden ONCE), esitlikte kimlik.
 */
const POOL_ORDER = { band: 1, idleSince: 1, _id: 1 } as const;

export class CouriersCollection extends MongoRepository<CourierDocument> {
  constructor(db: Db) {
    super(db, COLLECTIONS.COURIERS);
  }

  protected override indexes(): readonly IndexDescription[] {
    return [
      // Havuz sorgusu (T13.2): konum ($geoNear) + durum esitligi.
      {
        key: { lastLocation: '2dsphere', status: 1 },
        name: 'lastLocation_2dsphere_status',
      },
      // Bir siparisi en fazla bir kurye tasir (tekrar ve eszamanli atama).
      // Kismi: bos kuryelerde alan yoktur ve indekse girmez.
      {
        key: { currentOrderId: 1 },
        name: 'currentOrderId_unique',
        unique: true,
        partialFilterExpression: { currentOrderId: { $exists: true } },
      },
    ];
  }

  async findByOrder(orderId: string): Promise<CourierDocument | null> {
    return this.findOne({ currentOrderId: orderId });
  }

  /** Kimlikleriyle toplu okuma (T13.3 tick); birincil anahtardan. */
  async findByIds(ids: readonly string[]): Promise<CourierDocument[]> {
    return this.run('findByIds', () => this.collection.find({ _id: { $in: [...ids] } }).toArray());
  }

  /**
   * Havuzun ilk `limit` adayinin kimlikleri, sira kuralina gore: `near`'a
   * `rule.radiusMeters` icindeki IDLE kuryeler ($geoNear, 2dsphere indeksi).
   * `exclude`: bu talepte baska siparise gittigi gorulen adaylar; yeniden
   * okunmaz. Okumadir; adayi almak claimIfIdle'in isidir.
   */
  async poolCandidates(
    near: GeoPoint,
    rule: PoolRule,
    limit: number,
    exclude: readonly string[],
  ): Promise<string[]> {
    const rows = await this.run('poolCandidates', () =>
      this.collection
        .aggregate<{ _id: string }>([
          {
            $geoNear: {
              near: toGeoJson(near),
              key: 'lastLocation',
              distanceField: 'distanceMeters',
              maxDistance: rule.radiusMeters,
              query: {
                status: COURIER_STATUS.IDLE,
                ...(exclude.length === 0 ? {} : { _id: { $nin: [...exclude] } }),
              },
              spherical: true,
            },
          },
          { $addFields: { band: { $floor: { $divide: ['$distanceMeters', rule.bandMeters] } } } },
          { $sort: POOL_ORDER },
          { $limit: limit },
          { $project: { _id: 1 } },
        ])
        .toArray(),
    );
    return rows.map((row) => row._id);
  }

  /**
   * TEK atomik adim (B7): kurye ANCAK HALA IDLE ise BUSY olur, siparise baglanir
   * ve bosta beklemesi biter. Arada baska siparis aldiysa null (aday kaybedildi).
   * Siparise baska kurye bagliysa benzersiz indeks yazimi reddeder (CONFLICT).
   */
  async claimIfIdle(courierId: string, orderId: string, at: Date): Promise<CourierDocument | null> {
    return this.run('claimIfIdle', () =>
      this.collection.findOneAndUpdate(
        { _id: courierId, status: COURIER_STATUS.IDLE },
        {
          $set: { status: COURIER_STATUS.BUSY, currentOrderId: orderId, lastAssignedAt: at },
          $unset: { idleSince: '' },
        },
        { returnDocument: 'after' },
      ),
    );
  }

  /**
   * Siparisi tasiyan kuryeyi IDLE'a dondurur; bosta beklemesi `at`'te baslar.
   * lastAssignedAt ve konum kalir (kurye oldugu yerde bekler).
   */
  async releaseByOrder(
    orderId: string,
    at: Date,
    options: { location?: CourierDocument['lastLocation']; courierId?: string } = {},
  ): Promise<CourierDocument | null> {
    const { location, courierId } = options;
    const moved = location === undefined ? {} : { lastLocation: location, lastLocationAt: at };
    return this.run('releaseByOrder', () =>
      this.collection.findOneAndUpdate(
        { currentOrderId: orderId, ...(courierId === undefined ? {} : { _id: courierId }) },
        {
          $set: { status: COURIER_STATUS.IDLE, idleSince: at, ...moved },
          $unset: { currentOrderId: '' },
        },
        { returnDocument: 'after' },
      ),
    );
  }

  /** Seed: koleksiyonu bastan yazar. Transaction icinde cagrilir (oturum). */
  async replaceAll(documents: readonly CourierDocument[], options: SessionOption): Promise<void> {
    const session = options.session === undefined ? {} : { session: options.session };
    await this.run('replaceAll.delete', () => this.collection.deleteMany({}, session));
    if (documents.length === 0) {
      // insertMany bos diziyle hata firlatir.
      return;
    }
    await this.run('replaceAll.insert', () =>
      this.bulkCollection(options).insertMany([...documents], session),
    );
  }
}
