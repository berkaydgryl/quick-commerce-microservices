/**
 * `stock_ledger` koleksiyonunun repository'si (T10.2, ADR-18; ADR-05: yalnizca
 * stok servisinde).
 */

import type { SessionOption } from '@getir/mongo-kit';
import { MongoRepository } from '@getir/mongo-kit';
import type { AnyBulkWriteOperation, Db, IndexDescription } from 'mongodb';

import type { ReservationSettlement } from '../../domain/reservation.js';
import {
  LEDGER_KINDS,
  ledgerEntryId,
  OPENING_REASON,
  settlementOfKind,
} from '../../domain/stock-ledger.js';
import type {
  LedgerBalance,
  LedgerBalanceSource,
  LedgerEntry,
  StockLedger,
} from '../../domain/stock-ledger.js';
import type { StockLevel } from '../../domain/stock.js';
import { COLLECTIONS } from './documents.js';
import type { StockLedgerDocument } from './documents.js';

/** Siparisin sonucunu soyleyen turler (acilis bir siparis sonucu degildir). */
const SETTLEMENT_KINDS = [LEDGER_KINDS.RELEASE, LEDGER_KINDS.COMMIT];

export class StockLedgerRepository
  extends MongoRepository<StockLedgerDocument>
  implements StockLedger, LedgerBalanceSource
{
  constructor(db: Db) {
    super(db, COLLECTIONS.STOCK_LEDGER);
  }

  protected indexes(): readonly IndexDescription[] {
    return [
      // Siparisin sonucu (tekrar gelen birakma): yalnizca siparisli kayitlar.
      {
        key: { orderId: 1 },
        name: 'ledger_order',
        partialFilterExpression: { orderId: { $exists: true } },
      },
      // "Stok nereye gitti" ve market x SKU toplami (defter = onHand).
      { key: { marketId: 1, sku: 1, createdAt: 1 }, name: 'ledger_market_sku_created' },
    ];
  }

  /**
   * Varsa dokunmadan yazar ($setOnInsert, dogal `_id`): ayni kayit ikinci kez
   * gelirse degismez ve hata vermez (B14). Sira onemsiz: kayitlar bagimsiz.
   */
  async record(entries: readonly LedgerEntry[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    const operations: AnyBulkWriteOperation<StockLedgerDocument>[] = entries.map((entry) => {
      const { _id, ...fields } = toDocument(entry);
      return {
        updateOne: { filter: { _id }, update: { $setOnInsert: fields }, upsert: true },
      };
    });
    await this.run('record', () => this.collection.bulkWrite(operations, { ordered: false }));
  }

  /**
   * Kaydi yoksa yazar ve true doner; varsa DOKUNMAZ ve false doner. Onay bunu
   * eldeki adetle ayni transaction'da kullanir: kaydi olan kalemin adedi
   * tekrar dusmez (ADR-18).
   */
  async insertIfAbsent(entry: LedgerEntry, options: SessionOption = {}): Promise<boolean> {
    const { _id, ...fields } = toDocument(entry);
    const session = options.session === undefined ? {} : { session: options.session };
    const result = await this.run('insertIfAbsent', () =>
      this.collection.updateOne({ _id }, { $setOnInsert: fields }, { upsert: true, ...session }),
    );
    return result.upsertedCount === 1;
  }

  /** Market x SKU basina delta toplami (defter = onHand denetimi, B24). */
  async balances(): Promise<readonly LedgerBalance[]> {
    return this.run('balances', () =>
      this.collection
        .aggregate<LedgerBalance>([
          { $group: { _id: { marketId: '$marketId', sku: '$sku' }, total: { $sum: '$delta' } } },
          { $project: { _id: 0, marketId: '$_id.marketId', sku: '$_id.sku', total: 1 } },
        ])
        .toArray(),
    );
  }

  async settlementOf(
    marketId: string,
    orderId: string,
  ): Promise<ReservationSettlement | undefined> {
    const found = await this.findOne({ marketId, orderId, kind: { $in: SETTLEMENT_KINDS } });
    return found === null ? undefined : settlementOfKind(found.kind);
  }

  /**
   * Defteri acilis kayitlariyla bastan yazar (her market x SKU icin +onHand).
   * YALNIZCA seed kullanir ve stokla AYNI transaction'da cagrilmalidir: stok
   * bastan yazilinca eski hareketler yeni stogu anlatmaz.
   */
  async replaceWithOpening(
    levels: readonly StockLevel[],
    at: Date,
    options: SessionOption = {},
  ): Promise<void> {
    const session = options.session === undefined ? {} : { session: options.session };
    await this.run('replaceWithOpening.delete', () => this.collection.deleteMany({}, session));
    if (levels.length === 0) {
      // insertMany bos diziyle hata firlatir.
      return;
    }
    const documents = levels.map((level) =>
      toDocument({
        marketId: level.marketId,
        sku: level.sku,
        kind: LEDGER_KINDS.OPENING,
        delta: level.onHand,
        quantity: level.onHand,
        reason: OPENING_REASON,
        at,
      }),
    );
    await this.run('replaceWithOpening.insert', () =>
      this.collection.insertMany(documents, session),
    );
  }
}

function toDocument(entry: LedgerEntry): StockLedgerDocument {
  return {
    _id: ledgerEntryId(entry),
    marketId: entry.marketId,
    sku: entry.sku,
    kind: entry.kind,
    delta: entry.delta,
    quantity: entry.quantity,
    reason: entry.reason,
    ...(entry.orderId === undefined ? {} : { orderId: entry.orderId }),
    createdAt: entry.at,
  };
}
