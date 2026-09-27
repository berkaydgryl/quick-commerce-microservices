/**
 * `outbox` koleksiyonunun sorgulari ve indeksi: yalnizca BELGE okur-yazar (T7.3).
 * Koleksiyonun sahibi order-service'tir (ADR-05); baska servis okumaz, olaylari
 * stream:events'ten dinler.
 */

import { MongoRepository } from '@getir/mongo-kit';
import type { SessionOption } from '@getir/mongo-kit';
import type { Db, IndexDescription } from 'mongodb';

import type { OutboxDocument } from './documents.js';
import { COLLECTIONS } from './documents.js';

/** Yayin sirasi: olus zamani, esitlikte siparis surumu, sonra kimlik (kararli). */
const PUBLISH_ORDER = { occurredAt: 1, version: 1, _id: 1 } as const;

export class OutboxCollection extends MongoRepository<OutboxDocument> {
  constructor(db: Db) {
    super(db, COLLECTIONS.OUTBOX);
  }

  protected override indexes(): readonly IndexDescription[] {
    // Yayinci "publishedAt: null, yayin sirasiyla" okur: esitlik + siralama tek
    // indeksten (explain testi: test/integration/outbox.spec.ts). Roadmap'teki
    // "sparse" bilerek YOK: { publishedAt: null } sorgusu alani hic olmayan
    // belgeleri de esler; planlayici sparse indeksi bu sorgu icin kullanmaz.
    return [
      {
        key: { publishedAt: 1, ...PUBLISH_ORDER },
        name: 'publishedAt_occurredAt_version_id',
      },
    ];
  }

  async insertMany(
    documents: readonly OutboxDocument[],
    options: SessionOption = {},
  ): Promise<void> {
    if (documents.length === 0) {
      return;
    }
    await this.run('insertMany', () =>
      this.collection.insertMany([...documents], {
        ...(options.session === undefined ? {} : { session: options.session }),
      }),
    );
  }

  async findUnpublished(limit: number): Promise<OutboxDocument[]> {
    return this.run('findUnpublished', () =>
      this.collection.find({ publishedAt: null }).sort(PUBLISH_ORDER).limit(limit).toArray(),
    );
  }

  /** Zaten isaretli olana dokunmaz (ilk yayin zamani kalir). */
  async markPublished(ids: readonly string[], at: Date): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.run('markPublished', () =>
      this.collection.updateMany(
        { _id: { $in: [...ids] }, publishedAt: null },
        { $set: { publishedAt: at } },
      ),
    );
  }
}
