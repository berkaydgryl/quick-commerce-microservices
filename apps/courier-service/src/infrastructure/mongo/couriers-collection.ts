/**
 * couriers sorgulari ve indeksleri: yalnizca BELGE okur-yazar. Koleksiyonun
 * TEK sahibi courier-service'tir (ADR-05); order kuryeyi RPC ile ister.
 */

import { MongoRepository } from '@getir/mongo-kit';
import type { SessionOption } from '@getir/mongo-kit';
import type { Db, IndexDescription } from 'mongodb';

import { COURIER_STATUS } from '../../domain/courier.js';
import type { ClaimRequest } from '../../domain/courier-repository.js';
import type { CourierDocument } from './documents.js';
import { COLLECTIONS } from './documents.js';

/**
 * Atama sirasi: en uzun suredir is almamis once. Hic atanmamis kuryede alan
 * yoktur ve Mongo eksik alani tarihlerden ONCE siralar; esitlikte kimlik.
 */
const LEAST_RECENTLY_ASSIGNED_FIRST = { lastAssignedAt: 1, _id: 1 } as const;

export class CouriersCollection extends MongoRepository<CourierDocument> {
  constructor(db: Db) {
    super(db, COLLECTIONS.COURIERS);
  }

  protected override indexes(): readonly IndexDescription[] {
    return [
      // Atama sorgusu (B7): market + IDLE esitligi, atama sirasina gore siralama.
      // Roadmap'teki status+marketId indeksini kapsar.
      {
        key: { marketId: 1, status: 1, lastAssignedAt: 1, _id: 1 },
        name: 'marketId_status_lastAssignedAt',
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

  /**
   * TEK atomik adim (B7): secilen kurye ayni anda BUSY olur ve siparise baglanir.
   * Siparise baska kurye bagliysa benzersiz indeks yazimi reddeder (CONFLICT);
   * secilen kurye degismez.
   */
  async claimLeastRecentlyAssigned({
    marketId,
    orderId,
    at,
  }: ClaimRequest): Promise<CourierDocument | null> {
    return this.run('claimLeastRecentlyAssigned', () =>
      this.collection.findOneAndUpdate(
        { marketId, status: COURIER_STATUS.IDLE },
        { $set: { status: COURIER_STATUS.BUSY, currentOrderId: orderId, lastAssignedAt: at } },
        { sort: LEAST_RECENTLY_ASSIGNED_FIRST, returnDocument: 'after' },
      ),
    );
  }

  /** Siparisi tasiyan kuryeyi IDLE'a dondurur; lastAssignedAt kalir. */
  async releaseByOrder(orderId: string): Promise<CourierDocument | null> {
    return this.run('releaseByOrder', () =>
      this.collection.findOneAndUpdate(
        { currentOrderId: orderId },
        { $set: { status: COURIER_STATUS.IDLE }, $unset: { currentOrderId: '' } },
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
