import type { Db, IndexDescription } from 'mongodb';

import type { Category } from '../../domain/catalog.js';
import type { CategoryDocument } from './documents.js';
import { COLLECTIONS } from './documents.js';
import { fromCategoryDocument } from './mappers.js';
import { ReplaceableRepository } from './replaceable-repository.js';

export class CategoryRepository extends ReplaceableRepository<CategoryDocument> {
  constructor(db: Db) {
    super(db, COLLECTIONS.CATEGORIES);
  }

  protected override indexes(): readonly IndexDescription[] {
    // slug URL'de kullanilir: iki kategori ayni slug'i tasirsa derin baglanti
    // hangisine gidecegini bilemez.
    return [{ key: { slug: 1 }, unique: true, name: 'slug_unique' }];
  }

  /**
   * Tum kategoriler. Siralama use-case'tedir (domain/sortCategories): ayni
   * sortOrder'da ada gore Turkce siralama Mongo'nun varsayilan karsilastirmasiyla
   * yapilamaz. Liste kucuk (vitrin kategorileri), bellekte siralamak ucuzdur.
   */
  async listAll(): Promise<readonly Category[]> {
    const documents = await this.run('listAll', () => this.collection.find({}).toArray());
    return documents.map(fromCategoryDocument);
  }
}
