/**
 * markets: market konumu KOPYASI (T13.2). Kaydin sahibi catalog'dur (ADR-05);
 * kurye servisi havuzun merkezini buradan okur. Seed ve goc yazar.
 */

import { MongoRepository } from '@getir/mongo-kit';
import type { SessionOption } from '@getir/mongo-kit';
import type { Db, IndexDescription } from 'mongodb';

import type { MarketDocument } from './documents.js';
import { COLLECTIONS } from './documents.js';

export class MarketsCollection extends MongoRepository<MarketDocument> {
  constructor(db: Db) {
    super(db, COLLECTIONS.MARKETS);
  }

  /** Yalnizca _id ile okunur; ek indeks yok. */
  protected override indexes(): readonly IndexDescription[] {
    return [];
  }

  /** Seed: koleksiyonu bastan yazar. Transaction icinde cagrilir (oturum). */
  async replaceAll(documents: readonly MarketDocument[], options: SessionOption): Promise<void> {
    const session = options.session === undefined ? {} : { session: options.session };
    await this.run('replaceAll.delete', () => this.collection.deleteMany({}, session));
    if (documents.length === 0) {
      return;
    }
    await this.run('replaceAll.insert', () =>
      this.bulkCollection(options).insertMany([...documents], session),
    );
  }
}
