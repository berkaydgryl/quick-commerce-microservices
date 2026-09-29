/**
 * Use-case: kalici stogu (Mongo `stock`) demo verisiyle bastan yazar (T9.1).
 *
 * Yazmadan ONCE veri dogrulanir: yinelenen market x SKU, negatif ya da tam
 * sayi olmayan adet, bicimi bozuk kimlik yazimi durdurur. Yanlis veri yarim
 * yazilmaz; yazim tek transaction'dadir (writer).
 *
 * production'da REDDEDER: demo stogu gercek stogun ustune yazilmaz.
 */

import { marketIdSchema, skuSchema } from '@getir/contracts';
import { AppError } from '@getir/core';

import type { StockLevel, StockSeedWriter } from '../domain/stock.js';

export interface SeedStockDeps {
  readonly writer: StockSeedWriter;
  readonly levels: readonly StockLevel[];
  readonly isProduction: boolean;
}

export interface SeedStockResult {
  readonly markets: number;
  readonly levels: number;
}

export type SeedStock = () => Promise<SeedStockResult>;

export function createSeedStock(deps: SeedStockDeps): SeedStock {
  return async () => {
    if (deps.isProduction) {
      throw AppError.validation('production ortaminda demo stogu yazilmaz');
    }
    assertValidLevels(deps.levels);
    await deps.writer.replaceAll(deps.levels);
    return {
      markets: new Set(deps.levels.map((level) => level.marketId)).size,
      levels: deps.levels.length,
    };
  };
}

/** Veri hatasini yazimdan once ve TEK TEK soyler (hangi kalem, neden). */
export function assertValidLevels(levels: readonly StockLevel[]): void {
  const seen = new Set<string>();
  for (const level of levels) {
    const key = `${level.marketId}/${level.sku}`;
    if (!marketIdSchema.safeParse(level.marketId).success) {
      throw AppError.validation('Gecersiz market kimligi', {
        details: { marketId: level.marketId },
      });
    }
    if (!skuSchema.safeParse(level.sku).success) {
      throw AppError.validation('Gecersiz sku', { details: { sku: level.sku } });
    }
    if (!Number.isSafeInteger(level.onHand) || level.onHand < 0) {
      throw AppError.validation('Adet negatif olmayan tam sayi olmali', {
        details: { stock: key, onHand: level.onHand },
      });
    }
    if (seen.has(key)) {
      throw AppError.validation('Ayni market x sku iki kez', { details: { stock: key } });
    }
    seen.add(key);
  }
}
