/**
 * `stock` koleksiyonunun repository'si (ADR-05: yalnizca stok servisinde).
 */

import { AppError } from '@getir/core';
import type { SessionOption } from '@getir/mongo-kit';
import { MongoRepository } from '@getir/mongo-kit';
import type { Db, IndexDescription } from 'mongodb';

import type { StockLevel, StockLevelSource, StockMarketSource } from '../../domain/stock.js';
import { COLLECTIONS, stockDocumentId } from './documents.js';
import type { StockDocument } from './documents.js';

export class StockRepository
  extends MongoRepository<StockDocument>
  implements StockLevelSource, StockMarketSource
{
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

  /** Stogu olan marketler (supurucu, T10.3); indeks (marketId, sku) bunu karsilar. */
  async marketIds(): Promise<readonly string[]> {
    const ids = await this.run('marketIds', () => this.collection.distinct('marketId'));
    return [...ids].sort();
  }

  /**
   * Eldeki adedi dusurur (onay, T10.2 PR 2). IYIMSER KILIT (roadmap veri modeli):
   * okunan surum yazimda kosuldur; eslesmezse CONFLICT (P3: cagiran sinirli
   * yeniden dener). Eksiye dusmek reddedilmez: onay yapilmistir, iz gizlenmez.
   * @returns Yeni eldeki adet.
   */
  async decrementOnHand(
    marketId: string,
    sku: string,
    quantity: number,
    at: Date,
    options: SessionOption = {},
  ): Promise<number> {
    const current = await this.findById(stockDocumentId(marketId, sku), options);
    if (current === null) {
      throw AppError.internal('onaylanan kalemin stok kaydi yok', { details: { marketId, sku } });
    }
    const onHand = current.onHand - quantity;
    const session = options.session === undefined ? {} : { session: options.session };
    const result = await this.run('decrementOnHand', () =>
      this.collection.updateOne(
        { _id: current._id, version: current.version },
        { $set: { onHand, updatedAt: at }, $inc: { version: 1 } },
        session,
      ),
    );
    if (result.matchedCount === 0) {
      throw AppError.conflict('Stok kaydi ayni anda degisti', {
        details: { marketId, sku, version: current.version },
      });
    }
    return onHand;
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
