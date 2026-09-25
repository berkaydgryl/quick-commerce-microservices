import type { Db, IndexDescription } from 'mongodb';

import type { ProductDocument } from './documents.js';
import { COLLECTIONS } from './documents.js';
import { ReplaceableRepository } from './replaceable-repository.js';

/**
 * Ortak urun katalogu (ADR-15). Bugun yalnizca seed yazar. Market sayfasi ve
 * sepet dogrulamasi (BatchGetOffers, T9.3) urunu buradan DEGIL, teklifteki
 * kopyadan okur (offers): pazaryerinde fiyat teklife aittir. GetProduct T8.4'te
 * gelir; BatchGetProducts'i kullanan yok.
 */
export class ProductRepository extends ReplaceableRepository<ProductDocument> {
  constructor(db: Db) {
    super(db, COLLECTIONS.PRODUCTS);
  }

  protected override indexes(): readonly IndexDescription[] {
    // sku servisler arasi birlestirme anahtari; cift sku stok sayacini iki
    // urune bolerdi.
    return [{ key: { sku: 1 }, unique: true, name: 'sku_unique' }];
  }
}
