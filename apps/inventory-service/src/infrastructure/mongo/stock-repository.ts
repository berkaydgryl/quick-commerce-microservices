/**
 * `stock` koleksiyonunun repository'si (ADR-05: yalnizca stok servisinde).
 */

import type { SessionOption } from '@getir/mongo-kit';
import { MongoRepository } from '@getir/mongo-kit';
import type { Db, IndexDescription } from 'mongodb';

import type { StockLevel, StockLevelSource } from '../../domain/stock.js';
import { COLLECTIONS, stockDocumentId } from './documents.js';
import type { StockDocument } from './documents.js';

export class StockRepository extends MongoRepository<StockDocument> implements StockLevelSource {
  constructor(db: Db) {
    super(db, COLLECTIONS.STOCK);
  }

  protected indexes(): readonly IndexDescription[] {
    // Bir market x SKU icin tek kayit (roadmap veri modeli).
    return [{ key: { marketId: 1, sku: 1 }, unique: true, name: 'stock_market_sku_unique' }];
  }

  /**
   * Koleksiyonu verilen stokla degistirir; YALNIZCA seed kullanir ve
   * transaction icinde cagrilmalidir. Toplu silme is verisinde tehlikelidir;
   * mongo-kit tabanina bu yuzden konmadi (catalog ReplaceableRepository ile ayni gerekce).
   */
  async replaceAll(
    levels: readonly StockLevel[],
    at: Date,
    options: SessionOption = {},
  ): Promise<void> {
    const session = options.session === undefined ? {} : { session: options.session };
    await this.run('replaceAll.delete', () => this.collection.deleteMany({}, session));
    if (levels.length === 0) {
      // insertMany bos diziyle hata firlatir.
      return;
    }
    const documents = levels.map((level) => ({
      _id: stockDocumentId(level.marketId, level.sku),
      marketId: level.marketId,
      sku: level.sku,
      onHand: level.onHand,
      version: 1,
      updatedAt: at,
    }));
    await this.run('replaceAll.insert', () => this.collection.insertMany(documents, session));
  }

  /**
   * Kayitlari kacar kacar okur (imlecle): butun koleksiyon bellege alinmaz.
   * Sira `_id`'dir; ayni koleksiyon her okunusta ayni sirada gelir.
   */
  async *batches(batchSize: number): AsyncIterable<readonly StockLevel[]> {
    const cursor = this.collection
      .find({}, { projection: { _id: 0, marketId: 1, sku: 1, onHand: 1 } })
      .sort({ _id: 1 })
      .batchSize(batchSize);
    let batch: StockLevel[] = [];
    try {
      for await (const document of cursor) {
        batch.push({ marketId: document.marketId, sku: document.sku, onHand: document.onHand });
        if (batch.length === batchSize) {
          yield batch;
          batch = [];
        }
      }
    } finally {
      await cursor.close();
    }
    if (batch.length > 0) {
      yield batch;
    }
  }
}
