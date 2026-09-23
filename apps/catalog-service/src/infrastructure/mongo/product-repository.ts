import type { Db, IndexDescription } from 'mongodb';

import type { ProductDocument } from './documents.js';
import { COLLECTIONS } from './documents.js';
import { ReplaceableRepository } from './replaceable-repository.js';

/**
 * Ortak urun katalogu (ADR-15). Bugun yalnizca seed yazar; okuma uclari
 * (GetProduct, BatchGetProducts) sirasi gelince eklenir. Market sayfasi urunu
 * buradan DEGIL, teklifteki kopyadan okur (offers).
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
