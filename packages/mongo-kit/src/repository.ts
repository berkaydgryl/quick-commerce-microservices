/**
 * Repository tabani.
 *
 * NE YAPAR: koleksiyon tutamagini, indeks bildirimini ve her serviste birebir
 * tekrarlanacak CRUD'u tek yere toplar; her islemi hata ceviricisinden gecirir.
 *
 * NE YAPMAZ: is kurali icermez ve "her sey icin bir metot" sunmaz. Karmasik
 * sorgu (aggregate, 2dsphere, toplu yazim) alt sinifin kendi metodu olur ve
 * `this.collection` uzerinden dogrudan surucuyu kullanir - sarmalayici arkasina
 * saklanan bir sorgu, hata ayiklamayi zorlastirir.
 *
 * SAHIPLIK (ADR-05): bir koleksiyonun repository'si YALNIZCA sahibi servistedir.
 * Baska servisin koleksiyonuna repository acmak, kurali kagit uzerinde birakir.
 */

import type {
  ClientSession,
  Collection,
  Db,
  Document,
  Filter,
  IndexDescription,
  OptionalUnlessRequiredId,
  UpdateFilter,
  WithId,
} from 'mongodb';

import { toMongoAppError } from './errors.js';

/**
 * Tum belgelerin ortak sekli.
 *
 * `_id` string'dir, ObjectId degil: kimlikler @getir/core icindeki onekli
 * ureticiden gelir (ord_..., usr_...). Boylece kimligin turu log satirinda ve
 * Redis anahtarinda ciplak gozle okunur, iki ayri kimlik bicimi tasinmaz.
 */
export interface BaseDocument extends Document {
  _id: string;
}

/** Bir islemin istege bagli oturumu (transaction icinde calisirken verilir). */
export interface SessionOption {
  readonly session?: ClientSession;
}

/** `{ session }` secenegini yalnizca gercekten varsa ekler. */
function sessionOf(options: SessionOption): { session?: ClientSession } {
  return options.session === undefined ? {} : { session: options.session };
}

export abstract class MongoRepository<TDoc extends BaseDocument> {
  protected readonly collection: Collection<TDoc>;
  protected readonly collectionName: string;

  protected constructor(db: Db, collectionName: string) {
    this.collectionName = collectionName;
    this.collection = db.collection<TDoc>(collectionName);
  }

  /**
   * Bu koleksiyonun indeksleri. Alt sinif BILDIRIR, burasi uygular.
   * Indeksi koda yazmanin sebebi: hangi sorgunun hangi indekse dayandigi,
   * sorgunun yanindaki dosyada gorunsun ve gozden kacan indeks olmasin.
   */
  protected abstract indexes(): readonly IndexDescription[];

  /**
   * Indeksleri olusturur (varsa dokunmaz). Servis acilisinda bir kez cagrilir.
   * createIndexes tekrar tekrar cagrilabilir: ayni tanim varsa islem yapmaz.
   */
  async ensureIndexes(): Promise<void> {
    const descriptions = this.indexes();
    if (descriptions.length === 0) {
      return;
    }
    await this.run('ensureIndexes', () => this.collection.createIndexes([...descriptions]));
  }

  async findById(id: string, options: SessionOption = {}): Promise<WithId<TDoc> | null> {
    return this.run('findById', () =>
      this.collection.findOne({ _id: id } as Filter<TDoc>, sessionOf(options)),
    );
  }

  async findOne(filter: Filter<TDoc>, options: SessionOption = {}): Promise<WithId<TDoc> | null> {
    return this.run('findOne', () => this.collection.findOne(filter, sessionOf(options)));
  }

  async insertOne(
    document: OptionalUnlessRequiredId<TDoc>,
    options: SessionOption = {},
  ): Promise<void> {
    await this.run('insertOne', () => this.collection.insertOne(document, sessionOf(options)));
  }

  /** @returns Eslesen belge var miydi? (false = kayit bulunamadi) */
  async updateById(
    id: string,
    update: UpdateFilter<TDoc>,
    options: SessionOption = {},
  ): Promise<boolean> {
    const result = await this.run('updateById', () =>
      this.collection.updateOne({ _id: id } as Filter<TDoc>, update, sessionOf(options)),
    );
    return result.matchedCount > 0;
  }

  /** @returns Silinen belge var miydi? */
  async deleteById(id: string, options: SessionOption = {}): Promise<boolean> {
    const result = await this.run('deleteById', () =>
      this.collection.deleteOne({ _id: id } as Filter<TDoc>, sessionOf(options)),
    );
    return result.deletedCount > 0;
  }

  async count(filter: Filter<TDoc> = {}, options: SessionOption = {}): Promise<number> {
    return this.run('count', () => this.collection.countDocuments(filter, sessionOf(options)));
  }

  async exists(filter: Filter<TDoc>, options: SessionOption = {}): Promise<boolean> {
    const found = await this.findOne(filter, options);
    return found !== null;
  }

  /**
   * Her surucu cagrisi buradan gecer: hata AppError'a cevrilir, koleksiyon ve
   * islem adi hataya baglam olarak eklenir.
   */
  protected async run<T>(operation: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error: unknown) {
      throw toMongoAppError(error, { operation, collection: this.collectionName });
    }
  }
}
