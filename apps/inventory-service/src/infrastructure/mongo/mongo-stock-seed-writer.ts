/**
 * Seed'in yazicisi: kalici stogu TEK transaction'da bastan yazar. Yarida
 * kalan seed eski ile yeni stogun karisimini birakmaz.
 */

import type { MongoConnection } from '@getir/mongo-kit';

import type { StockLevel, StockSeedWriter } from '../../domain/stock.js';
import type { StockRepository } from './stock-repository.js';

export class MongoStockSeedWriter implements StockSeedWriter {
  constructor(
    private readonly connection: MongoConnection,
    private readonly repository: StockRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async replaceAll(levels: readonly StockLevel[]): Promise<void> {
    const at = this.now();
    await this.connection.withTransaction((session) =>
      this.repository.replaceAll(levels, at, { session }),
    );
  }
}
