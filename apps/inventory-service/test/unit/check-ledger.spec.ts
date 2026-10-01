/**
 * Defter = eldeki adet denetimi (T10.2 PR 2, B24): reseed sonrasi fark
 * raporlanir. Kaynaklar sahte; gercek Mongo ile stock-stores.spec.ts'te.
 */

import { describe, expect, it } from 'vitest';

import { createCheckLedger } from '../../src/application/check-ledger.js';
import type { LedgerBalance } from '../../src/domain/stock-ledger.js';
import type { StockLevel } from '../../src/domain/stock.js';

const MARKET = 'mkt_migros-jet-moda';

function check(levels: readonly StockLevel[], balances: readonly LedgerBalance[]) {
  return createCheckLedger({
    levels: {
      async *batches(batchSize: number) {
        for (let index = 0; index < levels.length; index += batchSize) {
          yield levels.slice(index, index + batchSize);
          await Promise.resolve();
        }
      },
    },
    ledger: { balances: () => Promise.resolve(balances) },
    batchSize: 2,
  })();
}

describe('createCheckLedger', () => {
  it('her market x SKU icin defter toplami eldeki adede esitse fark yok', async () => {
    const result = await check(
      [
        { marketId: MARKET, sku: 'SUT-1L', onHand: 22 },
        { marketId: MARKET, sku: 'KOLA-1L', onHand: 0 },
        { marketId: MARKET, sku: 'CIPS-150', onHand: 5 },
      ],
      [
        { marketId: MARKET, sku: 'SUT-1L', total: 22 },
        { marketId: MARKET, sku: 'CIPS-150', total: 5 },
      ],
    );

    // Defterde hic kaydi olmayan ve adedi 0 olan kalem tutar (toplam 0).
    expect(result).toEqual({ checked: 3, mismatches: [] });
  });

  it('tutmayan kalem, kaydi olmayan kalem ve yalnizca defterde olan kalem raporlanir', async () => {
    const result = await check(
      [
        { marketId: MARKET, sku: 'SUT-1L', onHand: 22 },
        { marketId: MARKET, sku: 'PEYNIR-500', onHand: 2 },
      ],
      [
        { marketId: MARKET, sku: 'SUT-1L', total: 24 },
        { marketId: MARKET, sku: 'YOK-1', total: 3 },
      ],
    );

    expect(result).toEqual({
      checked: 2,
      mismatches: [
        { marketId: MARKET, sku: 'SUT-1L', onHand: 22, ledger: 24 },
        { marketId: MARKET, sku: 'PEYNIR-500', onHand: 2, ledger: 0 },
        { marketId: MARKET, sku: 'YOK-1', onHand: undefined, ledger: 3 },
      ],
    });
  });
});
