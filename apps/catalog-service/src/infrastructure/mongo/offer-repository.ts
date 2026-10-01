import type { Db, Document, Filter, IndexDescription } from 'mongodb';

import type { Offer } from '../../domain/catalog.js';
import { searchWords } from '../../domain/catalog.js';
import type {
  MarketOfferMatches,
  OfferFilter,
  OfferPage,
  OfferReader,
  PageQuery,
} from '../../domain/offer-reader.js';
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
   * Metin aramasi (searchTerms uzerinde basi acik regex) arama indeksi
   * KULLANAMAZ: market indeksinden (market_cursor) o marketin teklifleri okunur,
   * kelimeler onlarin uzerinde suzulur. Market basina teklif sayisi kucuk
   * oldugu icin bilincli olarak kabul edildi (T9.4; entegrasyon testi plani
   * dogrular). Mongo metin indeksi ($text) yalnizca tam kelime eslestirir:
   * "çik" -> "Çikolata" (yazarken arama) onunla yapilamaz.
   * Genel arama (T9.6) ayni yoldan gider: yeni indeks yok; marketId ile
   * baslayan bir indeksten YALNIZCA kapsayan marketlerin (en fazla
   * MARKET_CANDIDATE_LIMIT) teklifleri okunur, kelimeler onlarin uzerinde suzulur.
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
    const base = listOffersFilter(filter);
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

  /**
   * Genel arama (T9.6): TEK toplama sorgusu (searchActiveOffersPipeline).
   * Entegrasyon testi AYNI boru hattiyla plani dogrular.
   */
  async searchActiveOffers(
    marketIds: readonly string[],
    query: string,
    perMarket: number,
  ): Promise<readonly MarketOfferMatches[]> {
    if (marketIds.length === 0 || searchWords(query).length === 0) {
      return [];
    }
    const groups = await this.run('searchActiveOffers', () =>
      this.collection
        .aggregate<SearchGroup>(searchActiveOffersPipeline(marketIds, query, perMarket))
        .toArray(),
    );
    return groups.map((group) => ({
      marketId: group._id,
      offers: group.offers.map(fromOfferDocument),
      totalMatches: group.total,
    }));
  }

  async listCategoryIdsWithOffers(marketId: string): Promise<readonly string[]> {
    return this.run('listCategoryIdsWithOffers', () =>
      this.collection.distinct('categoryId', { marketId, isActive: true }),
    );
  }

  /**
   * Tek sorgu (offersByProductIdsFilter): market_product_unique indeksinden
   * okunur - entegrasyon testi AYNI filtreyle kazanan plani dogrular. Bos
   * liste veritabanina gitmez.
   */
  async findOffersByProductIds(
    marketId: string,
    productIds: readonly string[],
  ): Promise<readonly Offer[]> {
    if (productIds.length === 0) {
      return [];
    }
    const documents = await this.run('findOffersByProductIds', () =>
      this.collection.find(offersByProductIdsFilter(marketId, productIds)).toArray(),
    );
    return documents.map(fromOfferDocument);
  }
}

/**
 * BatchGetOffers'in Mongo filtresi. Ayri ve disa acik: depo ve sorgu plani
 * testi AYNI filtreyi kullanir; biri degisirse test kopya bir sorguyu degil
 * gercek sorguyu olcer.
 */
export function offersByProductIdsFilter(
  marketId: string,
  productIds: readonly string[],
): Filter<OfferDocument> {
  return { marketId, productId: { $in: [...productIds] } };
}

/**
 * ListProducts'in Mongo filtresi. Ayri ve disa acik: depo ve sorgu plani testi
 * AYNI filtreyi kullanir (offersByProductIdsFilter gibi).
 */
export function listOffersFilter(filter: OfferFilter): Filter<OfferDocument> {
  return {
    marketId: filter.marketId,
    ...(filter.categoryId === undefined ? {} : { categoryId: filter.categoryId }),
    ...(filter.query === undefined ? {} : searchWordsFilter(filter.query)),
  };
}

/** Genel aramanin (T9.6) grubu: market, toplam, ilk N teklif belgesi. */
interface SearchGroup {
  readonly _id: string;
  readonly total: number;
  readonly offers: OfferDocument[];
}

/**
 * Genel aramanin boru hatti (T9.6). Ayri ve disa acik: depo ve sorgu plani
 * testi AYNI boru hattini kullanir. Marketler + aktiflik + kelimeler ile
 * suzulur, market sayfasiyla ayni sirada (_id) dizilir, market basina ilk
 * perMarket teklif ve toplam sayi toplanir ($firstN, Mongo 5.2+).
 */
export function searchActiveOffersPipeline(
  marketIds: readonly string[],
  query: string,
  perMarket: number,
): Document[] {
  return [
    { $match: { marketId: { $in: [...marketIds] }, isActive: true, ...searchWordsFilter(query) } },
    { $sort: { _id: 1 } },
    {
      $group: {
        _id: '$marketId',
        total: { $sum: 1 },
        offers: { $firstN: { input: '$$ROOT', n: perMarket } },
      },
    },
  ];
}

/**
 * Sorgunun kelime kosullari: kelime basina bir kosul. Dizi alanda regex:
 * elemanlardan BIRI eslesirse kosul saglanir ("ad ya da aciklama"); $and
 * kelimelerin HEPSINI ister. Bellek uygulamasindaki matchesQuery ile ayni
 * anlam. Kelime yoksa kosul yok.
 */
function searchWordsFilter(query: string): Filter<OfferDocument> {
  const words = searchWords(query);
  return words.length === 0
    ? {}
    : { $and: words.map((word) => ({ searchTerms: { $regex: escapeRegex(word) } })) };
}
