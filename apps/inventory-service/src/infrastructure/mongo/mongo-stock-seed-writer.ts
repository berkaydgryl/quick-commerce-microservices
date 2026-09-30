/**
 * Seed'in yazicisi: kalici stogu ve stok defterini TEK transaction'da bastan
 * yazar. Yarida kalan seed eski ile yeni stogun karisimini birakmaz; defter
 * her market x SKU icin bir acilis kaydiyla (+onHand) baslar, boylece defter
 * toplami onHand'e esittir (T10.2).
 */

import type { MongoConnection } from '@getir/mongo-kit';

import type { StockLevel, StockSeedWriter } from '../../domain/stock.js';
import type { StockLedgerRepository } from './stock-ledger-repository.js';
import type { StockRepository } from './stock-repository.js';

export class MongoStockSeedWriter implements StockSeedWriter {
  constructor(
    private readonly connection: MongoConnection,
    private readonly repository: StockRepository,
    private readonly ledger: StockLedgerRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async replaceAll(levels: readonly StockLevel[]): Promise<void> {
    const at = this.now();
    await this.connection.withTransaction(async (session) => {
      await this.repository.replaceAll(levels, at, { session });
      await this.ledger.replaceWithOpening(levels, at, { session });
    });
  }
}
