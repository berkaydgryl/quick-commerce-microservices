/**
 * Onayin Mongo yazimi (T10.2 PR 2, ADR-18): kalem basina defter kaydi (-adet)
 * ve eldeki adedin dusumu TEK transaction'da. Ya ikisi birlikte ya hicbiri.
 *
 * Tekrar guvenlidir: kalemin defter kaydi zaten varsa (onceki deneme yazmis)
 * o kalemin adedi tekrar dusmez. Kayit ile dusum ayni transaction'da oldugu
 * icin "kayit var" ile "adet dustu" ayrilamaz.
 *
 * Es zamanli onaylar ayni stok kaydina yazarsa kaybeden CONFLICT alir ve
 * bekleyerek yeniden dener (roadmap P3, mongo-kit retryOnConflict): surucunun
 * beklemesiz ve sure dolana kadar suren kendi denemesi kapalidir. Denemeler
 * biterse CONFLICT cagirana gider; Redis'teki iz durdugu icin ayni istegin
 * tekrari onayi tamamlar.
 */

import type { Logger } from '@getir/core';
import type { MongoConnection } from '@getir/mongo-kit';
import { retryOnConflict } from '@getir/mongo-kit';

import type { CommitWriteResult, LedgerEntry, StockCommitter } from '../../domain/stock-ledger.js';
import type { StockLedgerRepository } from './stock-ledger-repository.js';
import type { StockRepository } from './stock-repository.js';

export class MongoStockCommitter implements StockCommitter {
  constructor(
    private readonly connection: MongoConnection,
    private readonly stock: StockRepository,
    private readonly ledger: StockLedgerRepository,
    private readonly logger: Logger,
  ) {}

  commit(entries: readonly LedgerEntry[]): Promise<CommitWriteResult> {
    return retryOnConflict(
      () =>
        this.connection.withTransaction(
          async (session) => {
            let written = 0;
            const negative: { sku: string; onHand: number }[] = [];
            for (const entry of entries) {
              if (!(await this.ledger.insertIfAbsent(entry, { session }))) {
                continue;
              }
              const onHand = await this.stock.decrementOnHand(
                entry.marketId,
                entry.sku,
                entry.quantity,
                entry.at,
                { session },
              );
              written += 1;
              if (onHand < 0) {
                negative.push({ sku: entry.sku, onHand });
              }
            }
            return { written, negative };
          },
          { retryTransientErrors: false },
        ),
      {
        onRetry: (retry, delayMs) => {
          this.logger.info(
            { retry, delayMs, orderId: entries[0]?.orderId },
            'onay: stok kaydi ayni anda degisti, yeniden deneniyor',
          );
        },
      },
    );
  }
}
