/**
 * risk_events sorgulari ve indeksleri: yalnizca BELGE okur-yazar. Koleksiyonun
 * TEK sahibi risk-service'tir (ADR-05); digerleri GetLastEvaluation ile okur.
 */

import { MongoRepository } from '@getir/mongo-kit';
import type { Db, Filter, IndexDescription } from 'mongodb';

import type { RiskEventDocument } from './documents.js';
import { COLLECTIONS } from './documents.js';

/** En yeni once; ayni milisaniyede kimlik azalan (belirlenebilir sira). */
const LATEST_FIRST = { createdAt: -1, _id: -1 } as const;

export class RiskEventsCollection extends MongoRepository<RiskEventDocument> {
  constructor(db: Db) {
    super(db, COLLECTIONS.RISK_EVENTS);
  }

  protected override indexes(): readonly IndexDescription[] {
    return [
      // Kullanicinin son degerlendirmesi (roadmap: userId+createdAt).
      { key: { userId: 1, createdAt: -1 }, name: 'userId_createdAt' },
      // Bir siparisin son degerlendirmesi: saga siparis basina iki kez puanlar.
      // Siparissiz kayitlar (orderId yok) bu indekse girmez.
      {
        key: { orderId: 1, createdAt: -1 },
        name: 'orderId_createdAt',
        partialFilterExpression: { orderId: { $exists: true } },
      },
    ];
  }

  async findLatest(filter: Filter<RiskEventDocument>): Promise<RiskEventDocument | null> {
    return this.run('findLatest', () =>
      this.collection.find(filter).sort(LATEST_FIRST).limit(1).next(),
    );
  }
}
