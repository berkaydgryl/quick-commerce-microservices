/**
 * `cards` koleksiyonunun sorgulari ve indeksleri (T11.17): yalnizca BELGE
 * okur-yazar. Domain tipini bilmez; ceviri ve port uygulamasi
 * card-mongo-store.ts'tedir. Koleksiyonun TEK sahibi payment-service'tir (ADR-05).
 */

import { MongoRepository } from '@getir/mongo-kit';
import type { SessionOption } from '@getir/mongo-kit';
import type { Db, IndexDescription } from 'mongodb';

import { CARD_STATUS } from '../../domain/card.js';
import type { CardKey } from '../../domain/card.js';
import type { CardDocument } from './documents.js';
import { COLLECTIONS } from './documents.js';

export class CardsCollection extends MongoRepository<CardDocument> {
  constructor(db: Db) {
    super(db, COLLECTIONS.CARDS);
  }

  protected override indexes(): readonly IndexDescription[] {
    return [
      // Liste: kullanicinin silinmemis kartlari, yeniden eskiye.
      { key: { userId: 1, status: 1, createdAt: -1, _id: -1 }, name: 'userId_status_createdAt' },
      // IS KURALI, yalnizca hiz degil: kullanicinin kasasinda ayni kart (ilk 4,
      // son 4, son kullanma) bir kez. Silinmis kart sayilmaz: silinen kart yeniden
      // eklenebilir. Sayac transaction'i es zamanli eklemeyi zaten siraya koyar;
      // indeks son emniyettir.
      {
        key: { userId: 1, first4: 1, last4: 1, expiryMonth: 1, expiryYear: 1 },
        name: 'userId_card_active_unique',
        unique: true,
        partialFilterExpression: { status: CARD_STATUS.ACTIVE },
      },
    ];
  }

  /**
   * Silinmemis kartlar, yeniden eskiye. Sinirsiz okunur: sayac kasayi
   * SAVED_CARDS_MAX'ta tutar; kesmek fazla karti silinemez kilardi.
   */
  async listActive(userId: string): Promise<CardDocument[]> {
    return this.run('listActive', () =>
      this.collection
        .find({ userId, status: CARD_STATUS.ACTIVE })
        .sort({ createdAt: -1, _id: -1 })
        .toArray(),
    );
  }

  async findActiveByKey(key: CardKey, options: SessionOption = {}): Promise<CardDocument | null> {
    return this.findOne(
      {
        userId: key.userId,
        first4: key.first4,
        last4: key.last4,
        expiryMonth: key.expiryMonth,
        expiryYear: key.expiryYear,
        status: CARD_STATUS.ACTIVE,
      },
      options,
    );
  }

  /**
   * Kullanicinin silinmemis kartini yumusak siler; saglayici jetonu alani
   * KALDIRILIR. @returns silindi mi? (false: yok, baskasinin ya da silinmis)
   */
  async softDelete(
    userId: string,
    cardId: string,
    at: Date,
    options: SessionOption = {},
  ): Promise<boolean> {
    const result = await this.run('softDelete', () =>
      this.collection.updateOne(
        { _id: cardId, userId, status: CARD_STATUS.ACTIVE },
        { $set: { status: CARD_STATUS.DELETED, deletedAt: at }, $unset: { providerToken: '' } },
        options.session === undefined ? {} : { session: options.session },
      ),
    );
    return result.matchedCount > 0;
  }
}
