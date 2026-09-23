import type { Db, Filter, IndexDescription } from 'mongodb';

import { searchKey } from '../../domain/catalog.js';
import type {
  PageQuery,
  ProductFilter,
  ProductPage,
  ProductReader,
} from '../../domain/product-reader.js';
import type { ProductDocument } from './documents.js';
import { COLLECTIONS } from './documents.js';
import { fromProductDocument } from './mappers.js';
import { ReplaceableRepository } from './replaceable-repository.js';

/** Regex ozel karakterlerini kacisla: kullanici metni DESEN degil, duz metindir. */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class ProductRepository
  extends ReplaceableRepository<ProductDocument>
  implements ProductReader
{
  constructor(db: Db) {
    super(db, COLLECTIONS.PRODUCTS);
  }

  /**
   * Indeksler SORGULARA gore secildi (listProducts asagida):
   *   - sku unique        : servisler arasi birlestirme anahtari; cift sku stok
   *                         sayacini iki urune bolerdi.
   *   - categoryId + _id  : kategori filtresi + imlec siralamasi tek indeksten.
   *   - darkStoreIds + _id: depo filtresi (cok anahtarli) + imlec siralamasi.
   * Metin aramasi (searchTerms uzerinde basi acik regex) indeks KULLANAMAZ;
   * katalog kucuk oldugu icin bilincli olarak kabul edildi. Buyurse $text ya da
   * ayri arama motoru gerekir.
   */
  protected override indexes(): readonly IndexDescription[] {
    return [
      { key: { sku: 1 }, unique: true, name: 'sku_unique' },
      { key: { categoryId: 1, _id: 1 }, name: 'category_cursor' },
      { key: { darkStoreIds: 1, _id: 1 }, name: 'store_cursor' },
    ];
  }

  /**
   * Filtreli, imlecli sayfa.
   *
   * Imlec kurali bellek uygulamasiyla (domain/pagination) ayni: kayitlar _id'ye
   * gore sirali, sonraki sayfa "_id > son gorulen". Bir fazla kayit istenir;
   * gelirse devam var demektir - ikinci bir sayim sorgusu gerekmeden.
   */
  async listProducts(filter: ProductFilter, page: PageQuery): Promise<ProductPage> {
    const base = toMongoFilter(filter);
    const paged: Filter<ProductDocument> =
      page.token === '' ? base : { ...base, _id: { $gt: page.token } };

    const [documents, totalSize] = await Promise.all([
      this.run('listProducts', () =>
        this.collection
          .find(paged)
          .sort({ _id: 1 })
          .limit(page.size + 1)
          .toArray(),
      ),
      this.count(base),
    ]);

    const hasMore = documents.length > page.size;
    const items = documents.slice(0, page.size).map(fromProductDocument);
    const last = items.at(-1);

    return { items, nextPageToken: hasMore && last !== undefined ? last.id : '', totalSize };
  }
}

function toMongoFilter(filter: ProductFilter): Filter<ProductDocument> {
  const query: Filter<ProductDocument> = {};
  if (filter.categoryId !== undefined) {
    query.categoryId = filter.categoryId;
  }
  if (filter.darkStoreId !== undefined) {
    query.darkStoreIds = filter.darkStoreId;
  }
  if (filter.query !== undefined) {
    // Dizi alanda regex: elemanlardan BIRI eslesirse belge eslesir - bellek
    // uygulamasindaki "ad ya da aciklama" ile ayni anlam.
    query.searchTerms = { $regex: escapeRegex(searchKey(filter.query)) };
  }
  return query;
}
