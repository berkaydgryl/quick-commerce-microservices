/**
 * `card_wallets`: kullanici basina kart sayaci (T11.17). Kasa sinirinin
 * (SAVED_CARDS_MAX) kesin karari buradadir; ekleme ve silme sayaci kartla AYNI
 * transaction'da degistirir (card-mongo-store.ts).
 *
 * NEDEN SAYAC: transaction icinde "aktif kartlari say, sonra ekle" yetmez.
 * Anlik goruntu yalitiminda es zamanli iki ekleme ikisi de 9 sayar ve farkli
 * belgeler yazar; cakisma olmaz, kasa 11 olur (write skew). Iki ekleme de bu
 * belgeye yazinca yazma cakismasi dogar, surucu kaybedeni yeniden dener.
 */

import { MongoRepository, NO_OPERATION_TIMEOUT } from '@getir/mongo-kit';
import type { SessionOption } from '@getir/mongo-kit';
import { MongoServerError } from 'mongodb';
import type { Db, IndexDescription } from 'mongodb';

import type { CardWalletDocument } from './documents.js';
import { COLLECTIONS } from './documents.js';

/** Ayni anda acilan iki kopyadan ikincisinin createCollection hatasi. */
const NAMESPACE_EXISTS_CODE = 48;

export class CardWalletsCollection extends MongoRepository<CardWalletDocument> {
  constructor(private readonly db: Db) {
    super(db, COLLECTIONS.CARD_WALLETS);
  }

  /** Yalnizca _id (kullanici kimligi) ile okunur. */
  protected override indexes(): readonly IndexDescription[] {
    return [];
  }

  /**
   * Acilis isi: koleksiyon yoksa olusturur. Indeksi olmadigi icin ensureIndexes
   * olusturmaz; ilk kartin sayaci transaction icinde ORTUK olusturmaya
   * birakilmaz (anlik goruntu okumali transaction'da surume bagli davranis).
   * Suresiz (#51): acilis isidir.
   */
  async ensureCollection(): Promise<void> {
    await this.run('ensureCollection', async () => {
      const existing = await this.db
        .listCollections({ name: this.collectionName }, { nameOnly: true })
        .toArray();
      if (existing.length > 0) {
        return;
      }
      try {
        await this.db.createCollection(this.collectionName, { timeoutMS: NO_OPERATION_TIMEOUT });
      } catch (error: unknown) {
        // Baska bir kopya ayni anda olusturdu: istenen durum zaten var.
        if (!(error instanceof MongoServerError && error.code === NAMESPACE_EXISTS_CODE)) {
          throw error;
        }
      }
    });
  }

  /**
   * Kasada yer ayirir: sayac `limit`in altindaysa bir artirir. Iki adim: once
   * sayac yoksa 0 ile acilir, sonra kosullu artirilir. Tek adimda kosullu upsert
   * sayac sinirdayken eslesmez, ayni _id ile yeni belge eklemeye kalkar ve tekil
   * ihlali (CONFLICT) verirdi - "kasa dolu" yerine.
   * @returns yer ayrildi mi? (false: kasa dolu)
   */
  async reserve(userId: string, limit: number, options: SessionOption = {}): Promise<boolean> {
    const session = options.session === undefined ? {} : { session: options.session };
    await this.run('reserve', () =>
      this.collection.updateOne(
        { _id: userId },
        { $setOnInsert: { count: 0 } },
        { ...session, upsert: true },
      ),
    );
    const result = await this.run('reserve', () =>
      this.collection.updateOne(
        { _id: userId, count: { $lt: limit } },
        { $inc: { count: 1 } },
        session,
      ),
    );
    return result.matchedCount > 0;
  }

  /** Silinen kartin yerini birakir; sayac sifirin altina inmez. */
  async release(userId: string, options: SessionOption = {}): Promise<void> {
    await this.run('release', () =>
      this.collection.updateOne(
        { _id: userId, count: { $gt: 0 } },
        { $inc: { count: -1 } },
        options.session === undefined ? {} : { session: options.session },
      ),
    );
  }
}
