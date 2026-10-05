/**
 * routes: siparisin kurye rotasi (T13.2). Koleksiyonun TEK sahibi
 * courier-service'tir (ADR-05). Siparis basina tek belge (_id = siparis).
 */

import { ERROR_CODES, isAppError } from '@getir/core';
import { MongoRepository } from '@getir/mongo-kit';
import type { Db, IndexDescription } from 'mongodb';

import type { RouteDocument } from './documents.js';
import { COLLECTIONS } from './documents.js';

export class RoutesCollection extends MongoRepository<RouteDocument> {
  constructor(db: Db) {
    super(db, COLLECTIONS.ROUTES);
  }

  /** Yalnizca _id (siparis) ile okunur; ek indeks yok. */
  protected override indexes(): readonly IndexDescription[] {
    return [];
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
