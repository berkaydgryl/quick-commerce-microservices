/**
 * couriers sorgulari ve indeksleri: yalnizca BELGE okur-yazar. Koleksiyonun
 * TEK sahibi courier-service'tir (ADR-05); order kuryeyi RPC ile ister.
 */

import { MongoRepository } from '@getir/mongo-kit';
import type { SessionOption } from '@getir/mongo-kit';
import type { Db, Filter, IndexDescription } from 'mongodb';

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

  /**
   * Siparis tasiyan kuryeler, siparis kimligine gore artan sayfa (#205):
   * currentOrderId_unique (kismi) indeksinden; yeni indeks gerekmez.
   */
  async findCarrying(limit: number, afterOrderId?: string): Promise<CourierDocument[]> {
    return this.run('findCarrying', () =>
      this.collection
        .find(carryingFilter(afterOrderId))
        .sort({ currentOrderId: 1 })
        .limit(limit)
        .toArray(),
    );
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
   * Siparisi tasiyan (`courierId` verildiyse yalnizca O) kuryeyi IDLE'a
   * dondurur; bosta beklemesi `at`'te baslar. lastAssignedAt kalir. `location`
   * verilirse (teslimat noktasi ya da rotadaki anlik konum, #174) konum ve ani
   * yazilir; verilmezse konum kalir.
   *
   * Kurye kimligiyle birakma (#174) {_id, currentOrderId} filtresiyle ve _id
   * indeksiyle (ipucu) okur: plan sorgu planlayicisinin secimine birakilmaz.
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
        releaseFilter(orderId, courierId),
        {
          $set: { status: COURIER_STATUS.IDLE, idleSince: at, ...moved },
          $unset: { currentOrderId: '' },
        },
        {
          returnDocument: 'after',
          ...(courierId === undefined ? {} : { hint: RELEASE_BY_COURIER_HINT }),
        },
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

/** Kurye kimligiyle birakmanin indeksi (#174): _id (IXSCAN _id_). */
export const RELEASE_BY_COURIER_HINT = { _id: 1 } as const;

/**
 * Birakma filtresi: kurye kimligi verildiyse {_id, currentOrderId} (#174),
 * verilmezse siparisi tasiyan kurye (currentOrderId_unique).
 */
export function releaseFilter(orderId: string, courierId?: string): Filter<CourierDocument> {
  return courierId === undefined
    ? { currentOrderId: orderId }
    : { _id: courierId, currentOrderId: orderId };
}

/**
 * Siparis tasiyan kuryelerin sayfasi: kismi indeksin ($exists) filtresiyle
 * uyumlu, `afterOrderId`'den sonrakiler.
 */
export function carryingFilter(afterOrderId?: string): Filter<CourierDocument> {
  return afterOrderId === undefined
    ? { currentOrderId: { $exists: true } }
    : { currentOrderId: { $exists: true, $gt: afterOrderId } };
}
