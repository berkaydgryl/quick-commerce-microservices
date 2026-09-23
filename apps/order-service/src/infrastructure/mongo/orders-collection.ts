/**
 * `orders` koleksiyonunun sorgulari ve indeksleri: yalnizca BELGE okur-yazar.
 *
 * Domain tipini bilmez; ceviri ve port uygulamasi order-mongo-store.ts'tedir.
 * Koleksiyonun TEK sahibi order-service'tir (ADR-05).
 */

import { MongoRepository } from '@getir/mongo-kit';
import type { Db, Filter, IndexDescription } from 'mongodb';

import type { OrderHistoryCursor } from '../../domain/order-history-cursor.js';
import type { OrderDocument } from './documents.js';
import { COLLECTIONS } from './documents.js';

/** Gecmis sirasi: yeniden eskiye, esitlikte kimlik azalan (domain comesBefore ile ayni). */
const HISTORY_SORT = { createdAt: -1, _id: -1 } as const;

export class OrdersCollection extends MongoRepository<OrderDocument> {
  constructor(db: Db) {
    super(db, COLLECTIONS.ORDERS);
  }

  protected override indexes(): readonly IndexDescription[] {
    // ListMyOrders: esitlik (userId) + siralama (createdAt, _id) tek indeksten;
    // bellekte siralama (SORT asamasi) olmaz. `status` indeksi, durumu sorgulayan
    // ilk is (rezervasyon supurucusu, T11.x) geldiginde eklenir: bugun onu
    // kullanan sorgu yok ve gereksiz indeks her yazimi pahalilastirir.
    return [{ key: { userId: 1, createdAt: -1, _id: -1 }, name: 'userId_createdAt_id' }];
  }

  /**
   * Belgeyi YALNIZCA kayittaki surum `expectedVersion` ise degistirir.
   * @returns Degisti mi? (false = kayit yok ya da surum degismis)
   */
  async replaceIfVersion(document: OrderDocument, expectedVersion: number): Promise<boolean> {
    const result = await this.run('replaceIfVersion', () =>
      this.collection.replaceOne({ _id: document._id, version: expectedVersion }, document),
    );
    return result.matchedCount > 0;
  }

  /** Kullanicinin siparisleri, imlecten sonrakiler, en fazla `limit` belge. */
  async findHistory(
    userId: string,
    after: OrderHistoryCursor | undefined,
    limit: number,
  ): Promise<OrderDocument[]> {
    return this.run('findHistory', () =>
      this.collection
        .find({ userId, ...afterFilter(after) })
        .sort(HISTORY_SORT)
        .limit(limit)
        .toArray(),
    );
  }
}

/** Imlecten SONRAKI kayitlar (yeniden eskiye): daha eski, ya da ayni an ve daha kucuk kimlik. */
function afterFilter(after: OrderHistoryCursor | undefined): Filter<OrderDocument> {
  if (after === undefined) {
    return {};
  }
  return {
    $or: [
      { createdAt: { $lt: after.createdAt } },
      { createdAt: after.createdAt, _id: { $lt: after.orderId } },
    ],
  };
}
