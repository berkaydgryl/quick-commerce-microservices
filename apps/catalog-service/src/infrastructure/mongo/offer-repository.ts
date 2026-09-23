import type { Db, Filter, IndexDescription } from 'mongodb';

import { searchKey } from '../../domain/catalog.js';
import type { OfferFilter, OfferPage, OfferReader, PageQuery } from '../../domain/offer-reader.js';
import type { OfferDocument } from './documents.js';
import { COLLECTIONS } from './documents.js';
import { fromOfferDocument } from './mappers.js';
import { ReplaceableRepository } from './replaceable-repository.js';

/** Regex ozel karakterlerini kacisla: kullanici metni DESEN degil, duz metindir. */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class OfferRepository extends ReplaceableRepository<OfferDocument> implements OfferReader {
  constructor(db: Db) {
    super(db, COLLECTIONS.OFFERS);
  }

  /**
   * Indeksler SORGULARA gore:
   *   - marketId + productId unique : bir market bir urunu tek fiyatla satar;
   *                                    BatchGetOffers (T9.3) bu indeksten okur.
   *   - marketId + categoryId + _id  : market sayfasi kategori filtresi + imlec.
   *   - marketId + _id               : filtresiz market sayfasi + imlec.
   * Metin aramasi (searchTerms uzerinde basi acik regex) indeks KULLANAMAZ;
   * market basina teklif sayisi kucuk oldugu icin bilincli olarak kabul edildi.
   */
  protected override indexes(): readonly IndexDescription[] {
    return [
      { key: { marketId: 1, productId: 1 }, unique: true, name: 'market_product_unique' },
      { key: { marketId: 1, categoryId: 1, _id: 1 }, name: 'market_category_cursor' },
      { key: { marketId: 1, _id: 1 }, name: 'market_cursor' },
    ];
  }

  /**
   * Filtreli, imlecli sayfa. Imlec kurali bellek uygulamasiyla ayni: _id'ye
   * gore sirali, sonraki sayfa "_id > son gorulen". Bir fazla kayit istenir;
   * gelirse devam var demektir.
   */
  async listOffers(filter: OfferFilter, page: PageQuery): Promise<OfferPage> {
    const base = toMongoFilter(filter);
    const paged: Filter<OfferDocument> =
      page.token === '' ? base : { ...base, _id: { $gt: page.token } };

    const [documents, totalSize] = await Promise.all([
      this.run('listOffers', () =>
        this.collection
          .find(paged)
          .sort({ _id: 1 })
          .limit(page.size + 1)
          .toArray(),
      ),
      this.count(base),
    ]);

    const hasMore = documents.length > page.size;
    const items = documents.slice(0, page.size).map(fromOfferDocument);
    const last = items.at(-1);

    return { items, nextPageToken: hasMore && last !== undefined ? last.id : '', totalSize };
  }

  async listCategoryIdsWithOffers(marketId: string): Promise<readonly string[]> {
    return this.run('listCategoryIdsWithOffers', () =>
      this.collection.distinct('categoryId', { marketId, isActive: true }),
    );
  }
}

function toMongoFilter(filter: OfferFilter): Filter<OfferDocument> {
  const query: Filter<OfferDocument> = { marketId: filter.marketId };
  if (filter.categoryId !== undefined) {
    query.categoryId = filter.categoryId;
  }
  if (filter.query !== undefined) {
    // Dizi alanda regex: elemanlardan BIRI eslesirse belge eslesir - bellek
    // uygulamasindaki "ad ya da aciklama" ile ayni anlam.
    query.searchTerms = { $regex: escapeRegex(searchKey(filter.query)) };
  }
  return query;
}
