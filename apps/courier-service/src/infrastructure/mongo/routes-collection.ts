/**
 * routes: siparisin kurye rotasi (T13.2). Koleksiyonun TEK sahibi
 * courier-service'tir (ADR-05). Siparis basina tek belge (_id = siparis).
 * T13.3: tick ilerleyen rotalari (durumu DONE ya da ENDED olmayan) okur.
 */

import { ERROR_CODES, isAppError } from '@getir/core';
import { MongoRepository } from '@getir/mongo-kit';
import type { Db, Filter, IndexDescription, UpdateFilter } from 'mongodb';

import type { RouteDocument } from './documents.js';
import { COLLECTIONS } from './documents.js';

/**
 * Bitmis rota durumlari (domain ROUTE_STATE): tick bunlari OKUMAZ, yama bunlara
 * YAZILMAZ. Durum alani olmayan (T13.3 oncesi) rota ilerliyor sayilir: $nin
 * eksik alani da kapsar, goc gerekmez.
 */
const FINISHED: readonly NonNullable<RouteDocument['state']>[] = ['DONE', 'ENDED'];

export class RoutesCollection extends MongoRepository<RouteDocument> {
  constructor(db: Db) {
    super(db, COLLECTIONS.ROUTES);
  }

  /**
   * _id (siparis) ile okuma birincil anahtardandir. Tick (T13.3): durum +
   * uretilme ani. $nin indeks araliklarina cevrilir: bitmis gecmis hic
   * okunmaz; siralama yalnizca bitmemis rotalar uzerinde (aktif teslimat
   * sayisi kadar, kurye sayisiyla sinirli) bellekte yapilir.
   */
  protected override indexes(): readonly IndexDescription[] {
    return [{ key: { state: 1, createdAt: 1, _id: 1 }, name: 'state_createdAt_id' }];
  }

  /** Ilerleyen rotalar, eskiden yeniye, en fazla `limit`. */
  async findMoving(limit: number): Promise<RouteDocument[]> {
    return this.run('findMoving', () =>
      this.collection
        .find({ state: { $nin: [...FINISHED] } })
        .sort({ createdAt: 1, _id: 1 })
        .limit(limit)
        .toArray(),
    );
  }

  /**
   * Yamayi yazar: yalnizca belge hala ayni rota (kurye ve uretilme ani) ve
   * bitmemisse; `requireUndelivered` ise ayrica teslim ani KAYITLI degilse
   * (#177: iptalin ENDED yamasi). @returns guncel belge; kosul tutmadiysa null.
   */
  async updateCurrent(
    current: Pick<RouteDocument, '_id' | 'courierId' | 'createdAt'>,
    patch: UpdateFilter<RouteDocument>['$set'],
    options: { readonly requireUndelivered?: boolean } = {},
  ): Promise<RouteDocument | null> {
    return this.run('updateCurrent', () =>
      this.collection.findOneAndUpdate(
        currentRouteFilter(current, options.requireUndelivered === true),
        { $set: patch ?? {} },
        { returnDocument: 'after' },
      ),
    );
  }

  /**
   * Belgeyi yalnizca YOKSA yazar; varsa (eszamanli baska istek yazdi) var olani
   * doner. _id cakismasi mongo-kit'te CONFLICT'e cevrilir.
   */
  async insertOnce(document: RouteDocument): Promise<RouteDocument> {
    try {
      await this.insertOne(document);
      return document;
    } catch (error: unknown) {
      if (!isAppError(error) || error.code !== ERROR_CODES.CONFLICT) {
        throw error;
      }
      const existing = await this.findById(document._id);
      if (existing === null) {
        throw error;
      }
      return existing;
    }
  }

  /** Siparisin rotasini degistirir (yoksa yazar). */
  async replace(document: RouteDocument): Promise<void> {
    await this.run('replace', () =>
      this.collection.replaceOne({ _id: document._id }, document, { upsert: true }),
    );
  }
}

/**
 * Kosullu yamanin filtresi: ayni rota (kurye ve uretilme ani), bitmemis;
 * `requireUndelivered` ise teslim ani KAYITLI degil (#177: iptalin ENDED'i).
 */
export function currentRouteFilter(
  current: Pick<RouteDocument, '_id' | 'courierId' | 'createdAt'>,
  requireUndelivered: boolean,
): Filter<RouteDocument> {
  return {
    _id: current._id,
    courierId: current.courierId,
    createdAt: current.createdAt,
    state: { $nin: [...FINISHED] },
    ...(requireUndelivered ? { deliveredAt: { $exists: false } } : {}),
  };
}
