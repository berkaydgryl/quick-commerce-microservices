import type { Db, IndexDescription } from 'mongodb';

import type { Category } from '../../domain/catalog.js';
import type { CategoryReader } from '../../domain/category-reader.js';
import type { CategoryDocument } from './documents.js';
import { COLLECTIONS } from './documents.js';
import { fromCategoryDocument } from './mappers.js';
import { ReplaceableRepository } from './replaceable-repository.js';

export class CategoryRepository
  extends ReplaceableRepository<CategoryDocument>
  implements CategoryReader
{
  constructor(db: Db) {
    super(db, COLLECTIONS.CATEGORIES);
  }

  protected override indexes(): readonly IndexDescription[] {
    // slug URL'de kullanilir: iki kategori ayni slug'i tasirsa derin baglanti
    // hangisine gidecegini bilemez.
    return [{ key: { slug: 1 }, unique: true, name: 'slug_unique' }];
  }

  /**
   * En fazla `limit` kategori. Buradaki siralama yalnizca KESME icindir (hangi
   * kategoriler kalir; bellekteki karsiligi domain/firstCategories). Gosterim
   * sirasi use-case'tedir (domain/sortCategories): ayni sortOrder'da ada gore
   * Turkce siralama Mongo'nun varsayilan karsilastirmasiyla yapilamaz. Liste
   * kucuk (seed en fazla MAX_CATEGORY_COUNT yazar); indeks gerekmez.
   */
  async listCategories(limit: number): Promise<readonly Category[]> {
    const documents = await this.run('listCategories', () =>
      this.collection.find({}).sort({ sortOrder: 1, _id: 1 }).limit(limit).toArray(),
    );
    return documents.map(fromCategoryDocument);
  }
}
