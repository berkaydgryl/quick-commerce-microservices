/**
 * `orders` koleksiyonunun sorgulari ve indeksleri: yalnizca BELGE okur-yazar.
 *
 * Domain tipini bilmez; ceviri ve port uygulamasi order-mongo-store.ts'tedir.
 * Koleksiyonun TEK sahibi order-service'tir (ADR-05).
 */

import { MongoRepository } from '@getir/mongo-kit';
import type { SessionOption } from '@getir/mongo-kit';
import type { Db, Filter, IndexDescription } from 'mongodb';

import { ORDER_STATUS } from '@getir/core';
import type { OrderStatus } from '@getir/core';

import { COURIER_DISPATCH_STATUSES } from '../../domain/courier-dispatch.js';
import type { OrderHistoryCursor } from '../../domain/order-history-cursor.js';
import type { OrderDocument } from './documents.js';
import { COLLECTIONS } from './documents.js';

/** Gecmis sirasi: yeniden eskiye, esitlikte kimlik azalan (domain comesBefore ile ayni). */
const HISTORY_SORT = { createdAt: -1, _id: -1 } as const;

/** Supurucu sirasi (T11.2 PR 2): kilidi once dolan once, esitlikte kimlik. */
const EXPIRY_SORT = { 'reservation.expiresAt': 1, _id: 1 } as const;

/**
 * Kurye iscisinin sirasi (T13.1 PR 2): deneme ani olmayan (odenmis) once -
 * Mongo eksik alani tarihlerden ONCE siralar -, sonra deneme ani en eski;
 * esitlikte kimlik.
 */
const COURIER_DUE_SORT = { courierRetryAt: 1, _id: 1 } as const;

export class OrdersCollection extends MongoRepository<OrderDocument> {
  constructor(db: Db) {
    super(db, COLLECTIONS.ORDERS);
  }

  protected override indexes(): readonly IndexDescription[] {
    // ListMyOrders: esitlik (userId) + siralama (createdAt, _id) tek indeksten;
    // bellekte siralama (SORT asamasi) olmaz.
    // Supurucu (T11.2 PR 2): durum ($in, iki deger) + kilidin bitisi araligi ve
    // ayni siraya gore okuma; durum basina indeks araliklari birlestirilir
    // (SORT_MERGE), bellekte siralama olmaz.
    // Kurye iscisi (T13.1 PR 2): KISMI, yalnizca kurye bekleyebilen iki durum
    // (PAID, PREPARING) indekse girer; teslim edilen ve iptal edilen gecmis
    // girmez. Sorgunun iki kolu ($or) ayni indeksten okunur ve ayni siraya
    // gore birlestirilir (SORT_MERGE).
    return [
      { key: { userId: 1, createdAt: -1, _id: -1 }, name: 'userId_createdAt_id' },
      {
        key: { status: 1, 'reservation.expiresAt': 1, _id: 1 },
        name: 'status_reservationExpiresAt_id',
      },
      {
        key: { status: 1, courierRetryAt: 1, _id: 1 },
        name: 'status_courierRetryAt_id',
        partialFilterExpression: { status: { $in: [...COURIER_DISPATCH_STATUSES] } },
      },
    ];
  }

  /**
   * Belgeyi YALNIZCA kayittaki surum `expectedVersion` ise degistirir.
   * @returns Degisti mi? (false = kayit yok ya da surum degismis)
   */
  async replaceIfVersion(
    document: OrderDocument,
    expectedVersion: number,
    options: SessionOption = {},
  ): Promise<boolean> {
    const result = await this.run('replaceIfVersion', () =>
      this.collection.replaceOne(
        { _id: document._id, version: expectedVersion },
        document,
        options.session === undefined ? {} : { session: options.session },
      ),
    );
    return result.matchedCount > 0;
  }

  /** Kullanicinin siparisleri, imlecten sonrakiler, en fazla `limit` belge. */
  async findHistory(
    userId: string,
    after: OrderHistoryCursor | undefined,
    limit: number,
  ): Promise<OrderDocument[]> {
    return this.run('findHistory', () =>
      this.collection
        .find({ userId, ...afterFilter(after) })
        .sort(HISTORY_SORT)
        .limit(limit)
        .toArray(),
    );
  }

  /**
   * Verilen durumlarda kilidi `now` itibariyla dolmus belgeler, kilidi once dolan
   * once, en fazla `limit` tane (status_reservationExpiresAt_id indeksi). Kilidi
   * olmayan belge `$lte` ile eslesmez.
   */
  async findExpiredReservations(
    statuses: readonly OrderStatus[],
    now: Date,
    limit: number,
  ): Promise<OrderDocument[]> {
    return this.run('findExpiredReservations', () =>
      this.collection
        .find({ status: { $in: [...statuses] }, 'reservation.expiresAt': { $lte: now } })
        .sort(EXPIRY_SORT)
        .limit(limit)
        .toArray(),
    );
  }

  /**
   * Kurye istenecek belgeler (domain courier-dispatch.ts isCourierDue ile ayni
   * kural): butun PAID'ler ve deneme ani `now`'dan once ya da `now`'da olan
   * kuryesiz PREPARING'ler; en fazla `limit` tane (status_courierRetryAt_id).
   * Deneme ani olmayan PREPARING `$lte` ile eslesmez.
   */
  async findAwaitingCourier(now: Date, limit: number): Promise<OrderDocument[]> {
    return this.run('findAwaitingCourier', () =>
      this.collection
        .find({
          $or: [
            { status: ORDER_STATUS.PAID },
            {
              status: ORDER_STATUS.PREPARING,
              courier: { $exists: false },
              courierRetryAt: { $lte: now },
            },
          ],
        })
        .sort(COURIER_DUE_SORT)
        .limit(limit)
        .toArray(),
    );
  }

  /**
   * Kullanicinin verilen durumlardaki siparis sayisi ve tutar toplami, durum
   * basina TEK aggregation (en fazla statuses.length satir doner). userId
   * esitligi userId_createdAt_id indeksinin onekini kullanir.
   */
  async countAndSumByStatus(
    userId: string,
    statuses: readonly OrderStatus[],
    options: CountByStatusOptions = {},
  ): Promise<ReadonlyMap<OrderStatus, { readonly count: number; readonly totalMinor: number }>> {
    const excluded = options.excludeCancellationNotes ?? [];
    const rows = await this.run('countAndSumByStatus', () =>
      this.collection
        .aggregate<{ _id: OrderStatus; count: number; totalMinor: number }>([
          { $match: { userId, status: { $in: [...statuses] } } },
          ...(excluded.length === 0 ? [] : [{ $match: notCancelledWith(excluded) }]),
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 },
              totalMinor: { $sum: '$pricing.totalMinor' },
            },
          },
        ])
        .toArray(),
    );
    return new Map(rows.map((row) => [row._id, { count: row.count, totalMinor: row.totalMinor }]));
  }

  /**
   * Kullanicinin verilen durumlardan birinde en az bir siparisi var mi?
   * userId esitligi mevcut userId_createdAt_id indeksinin onekini kullanir;
   * durum filtresi yalnizca o kullanicinin siparisleri uzerinde calisir.
   */
  async existsWithStatus(userId: string, statuses: readonly OrderStatus[]): Promise<boolean> {
    const found = await this.run('existsWithStatus', () =>
      this.collection.findOne(
        { userId, status: { $in: [...statuses] } },
        { projection: { _id: 1 } },
      ),
    );
    return found !== null;
  }

  /**
   * Verilen kullanicilarin butun siparislerini siler (persona seed'i, T8.1).
   * userId esitligi userId_createdAt_id indeksinin onekini kullanir.
   * @returns Silinen belge sayisi.
   */
  async deleteByUsers(userIds: readonly string[], options: SessionOption = {}): Promise<number> {
    const result = await this.run('deleteByUsers', () =>
      this.collection.deleteMany(
        { userId: { $in: [...userIds] } },
        options.session === undefined ? {} : { session: options.session },
      ),
    );
    return result.deletedCount;
  }

  /** Belgeleri toplu yazar (persona seed'i). Bos listede surucuye gidilmez. */
  async insertMany(
    documents: readonly OrderDocument[],
    options: SessionOption = {},
  ): Promise<void> {
    if (documents.length === 0) {
      return;
    }
    await this.run('insertMany', () =>
      this.bulkCollection(options).insertMany(
        [...documents],
        options.session === undefined ? {} : { session: options.session },
      ),
    );
  }
}

/** Imlecten SONRAKI kayitlar (yeniden eskiye): daha eski, ya da ayni an ve daha kucuk kimlik. */
function afterFilter(after: OrderHistoryCursor | undefined): Filter<OrderDocument> {
  if (after === undefined) {
    return {};
  }
  return {
    $or: [
      { createdAt: { $lt: after.createdAt } },
      { createdAt: after.createdAt, _id: { $lt: after.orderId } },
    ],
  };
}

export interface CountByStatusOptions {
  /**
   * Son kaydinin notu bunlardan biri olan CANCELLED siparisler sayilmaz
   * (sistem iptalleri, T11.2; SYSTEM_CANCELLATION_NOTES).
   */
  readonly excludeCancellationNotes?: readonly string[];
}

/** "CANCELLED ve son notu listede" OLMAYAN belgeler; not yoksa bos metin sayilir. */
function notCancelledWith(notes: readonly string[]): Filter<OrderDocument> {
  return {
    $expr: {
      $not: [
        {
          $and: [
            { $eq: ['$status', ORDER_STATUS.CANCELLED] },
            {
              $in: [
                {
                  $ifNull: [
                    { $getField: { field: 'note', input: { $arrayElemAt: ['$timeline', -1] } } },
                    '',
                  ],
                },
                [...notes],
              ],
            },
          ],
        },
      ],
    },
  };
}
