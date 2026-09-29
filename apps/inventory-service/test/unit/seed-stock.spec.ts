import { AppError, ERROR_CODES } from '@getir/core';
import { describe, expect, it, vi } from 'vitest';

import { createSeedStock } from '../../src/application/seed-stock.js';
import type { StockLevel, StockSeedWriter } from '../../src/domain/stock.js';

const MARKET = 'mkt_migros-jet-moda';
const valid: readonly StockLevel[] = [
  { marketId: MARKET, sku: 'SUT-1L', onHand: 24 },
  { marketId: 'mkt_a101-caferaga', sku: 'SUT-1L', onHand: 0 },
];

function writer() {
  const replaceAll = vi.fn<StockSeedWriter['replaceAll']>(() => Promise.resolve());
  return { writer: { replaceAll }, replaceAll };
}

describe('stok seed i (T9.1)', () => {
  it('gecerli stogu yazar ve sayilari doner', async () => {
    const { writer: seedWriter, replaceAll } = writer();

    const result = await createSeedStock({
      writer: seedWriter,
      levels: valid,
      isProduction: false,
    })();

    expect(replaceAll).toHaveBeenCalledWith(valid);
    expect(result).toEqual({ markets: 2, levels: 2 });
  });

  it('production da reddeder, hic yazmaz', async () => {
    const { writer: seedWriter, replaceAll } = writer();

    await expect(
      createSeedStock({ writer: seedWriter, levels: valid, isProduction: true })(),
    ).rejects.toBeInstanceOf(AppError);
    expect(replaceAll).not.toHaveBeenCalled();
  });

  it.each([
    ['yinelenen market x sku', [...valid, { marketId: MARKET, sku: 'SUT-1L', onHand: 3 }]],
    ['negatif adet', [{ marketId: MARKET, sku: 'SUT-1L', onHand: -1 }]],
    ['tam sayi olmayan adet', [{ marketId: MARKET, sku: 'SUT-1L', onHand: 1.5 }]],
    ['bicimi bozuk sku', [{ marketId: MARKET, sku: 'sut 1l', onHand: 1 }]],
    ['bicimi bozuk market', [{ marketId: 'migros', sku: 'SUT-1L', onHand: 1 }]],
  ])('%s yazimdan once reddedilir', async (_name, levels) => {
    const { writer: seedWriter, replaceAll } = writer();

    await expect(
      createSeedStock({ writer: seedWriter, levels, isProduction: false })(),
    ).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
    });
    expect(replaceAll).not.toHaveBeenCalled();
  });
});
