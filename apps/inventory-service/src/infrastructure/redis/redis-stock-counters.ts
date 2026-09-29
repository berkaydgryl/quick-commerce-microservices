/**
 * Redis'teki hizli sayaclar: `stock:{market}:avail:{sku}` (ADR-03, redis-kit).
 *
 * Bir marketin butun sayaclari ayni hash-tag'dedir ({market}): toplu okuma TEK
 * MGET, Cluster'da da tek slot. Sayaclar bilincli olarak TTL'sizdir (ADR-03;
 * proje kurallarindaki Redis TTL istisnasi): stok suresi dolan bir onbellek
 * degil, sicak yolun karar mercidir.
 */

import type { Logger } from '@getir/core';
import { AppError } from '@getir/core';
import type { RedisConnection } from '@getir/redis-kit';
import { stockAvailKey } from '@getir/redis-kit';

import type {
  CounterSeedMode,
  StockCounterReader,
  StockCounterWriter,
  StockLevel,
} from '../../domain/stock.js';

type RedisClient = RedisConnection['redis'];

/** Sayacin kayitli bicimi: onluk tam sayi (INCRBY/DECRBY ile uyumlu). */
const COUNTER_PATTERN = /^-?\d+$/;

export class RedisStockCounters implements StockCounterReader, StockCounterWriter {
  constructor(
    private readonly redis: RedisClient,
    private readonly logger: Logger,
  ) {}

  async available(marketId: string, skus: readonly string[]): Promise<ReadonlyMap<string, number>> {
    if (skus.length === 0) {
      return new Map();
    }
    const values = await this.redis.mget(...skus.map((sku) => stockAvailKey(marketId, sku)));
    const found = new Map<string, number>();
    skus.forEach((sku, index) => {
      const value = values[index];
      if (value !== null && value !== undefined) {
        found.set(sku, this.parse(marketId, sku, value));
      }
    });
    return found;
  }

  async write(levels: readonly StockLevel[], mode: CounterSeedMode): Promise<number> {
    if (levels.length === 0) {
      return 0;
    }
    const pipeline = this.redis.pipeline();
    for (const level of levels) {
      const key = stockAvailKey(level.marketId, level.sku);
      if (mode === 'missing') {
        pipeline.set(key, String(level.onHand), 'NX');
      } else {
        pipeline.set(key, String(level.onHand));
      }
    }
    const results = (await pipeline.exec()) ?? [];
    let written = 0;
    for (const [error, reply] of results) {
      if (error !== null) {
        throw AppError.internal('stok sayaci yazilamadi', { cause: error });
      }
      // SET NX var olan anahtarda nil doner: yazilmadi, sayilmaz.
      if (reply === 'OK') {
        written += 1;
      }
    }
    return written;
  }

  /**
   * Sayaci sayiya cevirir. Negatif sayac (fazla satis izi) satilabilir adet
   * olarak 0 doner ve UYARI yazilir: gizlenmez. Tam sayi olmayan deger bozuk
   * kayittir: tahmin yurutulmez, hata doner.
   */
  private parse(marketId: string, sku: string, value: string): number {
    if (!COUNTER_PATTERN.test(value)) {
      throw AppError.internal('stok sayaci bozuk', { details: { marketId, sku } });
    }
    const count = Number.parseInt(value, 10);
    if (count < 0) {
      this.logger.warn({ marketId, sku, counter: count }, 'stok sayaci negatif; 0 donuluyor');
      return 0;
    }
    return count;
  }
}
