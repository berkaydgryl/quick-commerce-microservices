/**
 * `payments` koleksiyonunun sorgulari ve indeksleri: yalnizca BELGE okur-yazar.
 *
 * Domain tipini bilmez; ceviri ve port uygulamasi payment-mongo-store.ts'tedir.
 * Koleksiyonun TEK sahibi payment-service'tir (ADR-05): order bir odemeyi
 * yalnizca GetPayment RPC'si ile okur.
 */

import { MongoRepository } from '@getir/mongo-kit';
import type { Db, IndexDescription } from 'mongodb';

import type { PaymentDocument } from './documents.js';
import { COLLECTIONS } from './documents.js';

export class PaymentsCollection extends MongoRepository<PaymentDocument> {
  constructor(db: Db) {
    super(db, COLLECTIONS.PAYMENTS);
  }

  protected override indexes(): readonly IndexDescription[] {
    // Ikisi de IS KURALIDIR, yalnizca hiz degil:
    // - orderId unique: siparis basina tek odeme (roadmap veri modeli).
    // - idempotencyKey unique: ayni niyet iki kayit acamaz (ADR-08). Es zamanli
    //   iki Charge'dan ikincisi burada durur ve tekrar-istek yoluna duser.
    // Confirm3Ds de orderId ile okur; jeton icin ayri indeks gerekmez.
    return [
      { key: { orderId: 1 }, name: 'orderId_unique', unique: true },
      { key: { idempotencyKey: 1 }, name: 'idempotencyKey_unique', unique: true },
    ];
  }

  async findByOrderId(orderId: string): Promise<PaymentDocument | null> {
    return this.findOne({ orderId });
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<PaymentDocument | null> {
    return this.findOne({ idempotencyKey });
  }

  /**
   * Belgeyi YALNIZCA kayittaki surum `expectedVersion` ise degistirir.
   * @returns Degisti mi? (false = kayit yok ya da surum degismis)
   */
  async replaceIfVersion(document: PaymentDocument, expectedVersion: number): Promise<boolean> {
    const result = await this.run('replaceIfVersion', () =>
      this.collection.replaceOne({ _id: document._id, version: expectedVersion }, document),
    );
    return result.matchedCount > 0;
  }
}
