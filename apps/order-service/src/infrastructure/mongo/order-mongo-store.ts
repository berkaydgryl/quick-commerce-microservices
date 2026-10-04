/**
 * Siparis portlarinin Mongo uygulamasi: domain <-> belge cevirisi ve depo
 * sozlesmesinin hatalari. Sorgu yazmaz; sorgular orders-collection.ts'tedir.
 *
 * Bellek uygulamasiyla ayni sozlesme testinden gecer
 * (test/support/order-repository-contract.ts).
 */

import { ERROR_CODES, isAppError, ORDER_STATUS } from '@getir/core';
import type { MongoConnection } from '@getir/mongo-kit';
import { currentCorrelation } from '@getir/observability';
import type { ClientSession } from 'mongodb';

import type { AwaitingCourierFinder } from '../../domain/awaiting-courier-finder.js';
import type { ExpiredOrderFinder } from '../../domain/expired-order-finder.js';
import type { OrderEvent } from '../../domain/order-events.js';
import { cursorOf } from '../../domain/order-history-cursor.js';
import type {
  OrderHistoryPage,
  OrderHistoryQuery,
  OrderHistoryReader,
  RiskHistory,
} from '../../domain/order-history-reader.js';
import { PAID_ORDER_STATUSES, toRiskHistory } from '../../domain/order-history-reader.js';
import type { CorrelationSource } from '../../domain/order-outbox.js';
import type { OrderRepository } from '../../domain/order-repository.js';
import { orderAlreadyExists, orderVersionConflict } from '../../domain/order-repository.js';
import type { Order } from '../../domain/order.js';
import {
  EXPIRY_SWEPT_STATUSES,
  SYSTEM_CANCELLATION_NOTES,
} from '../../domain/stock-reservation.js';
import type { OutboxDocument } from './documents.js';
import { fromOrderDocument, toOrderDocument } from './mappers.js';
import type { OrdersCollection } from './orders-collection.js';
import type { OutboxCollection } from './outbox-collection.js';
import { toOutboxDocument } from './outbox-mappers.js';

/**
 * YAZIM = TEK TRANSACTION (T7.3, ADR-04): siparis belgesi ve outbox satirlari
 * ayni oturumda yazilir. Surum cakismasi transaction icinde firlatilir;
 * transaction geri alinir ve olay da yazilmaz. (Mongo tek dugumlu replica set
 * olarak calisir - transaction'in on kosulu.) Outbox satiri yazan istegin izini
 * (requestId, traceparent; D16) tasir.
 */
export class OrderMongoStore
  implements OrderRepository, OrderHistoryReader, ExpiredOrderFinder, AwaitingCourierFinder
{
  constructor(
    private readonly orders: OrdersCollection,
    private readonly outbox: OutboxCollection,
    private readonly transactions: Pick<MongoConnection, 'withTransaction'>,
    private readonly correlation: CorrelationSource = currentCorrelation,
  ) {}

  async insert(order: Order, events: readonly OrderEvent[]): Promise<void> {
    // Istegin izi transaction'a girmeden alinir (D16): yeniden denenen
    // transaction da ayni izi yazar.
    const documents = this.outboxDocuments(events);
    await this.transactions.withTransaction(async (session) => {
      await this.insertOrder(order, session);
      await this.outbox.insertMany(documents, { session });
    });
  }

  private outboxDocuments(events: readonly OrderEvent[]): OutboxDocument[] {
    const correlation = this.correlation();
    return events.map((event) => toOutboxDocument(event, correlation));
  }

  /**
   * mongo-kit tekil ihlali CONFLICT'e cevirir; siparis _id tekrarinda depo
   * sozlesmesinin hatasini veriyoruz (bellek uygulamasiyla ayni ayrinti).
   * Esleme YALNIZCA siparis yazimindadir: ayni transaction'daki olay tekrari
   * "siparis zaten var" diye raporlanmasin.
   */
  private async insertOrder(order: Order, session: ClientSession): Promise<void> {
    try {
      await this.orders.insertOne(toOrderDocument(order), { session });
    } catch (error: unknown) {
      throw isAppError(error) && error.code === ERROR_CODES.CONFLICT
        ? orderAlreadyExists(order.id)
        : error;
    }
  }

  async update(
    order: Order,
    expectedVersion: number,
    events: readonly OrderEvent[],
  ): Promise<void> {
    const documents = this.outboxDocuments(events);
    await this.transactions.withTransaction(async (session) => {
      const replaced = await this.orders.replaceIfVersion(toOrderDocument(order), expectedVersion, {
        session,
      });
      if (!replaced) {
        // Transaction icinde firlatilir: geri alinir, outbox'a da yazilmaz.
        throw orderVersionConflict(order.id, expectedVersion);
      }
      await this.outbox.insertMany(documents, { session });
    });
  }

  async findById(orderId: string): Promise<Order | null> {
    const document = await this.orders.findById(orderId);
    return document === null ? null : fromOrderDocument(document);
  }

  async listByUser({ userId, pageSize, after }: OrderHistoryQuery): Promise<OrderHistoryPage> {
    // Bir fazlasini okumak "sonraki sayfa var mi" sorusunu ayri sayim yapmadan cevaplar.
    const documents = await this.orders.findHistory(userId, after, pageSize + 1);

    const orders = documents.slice(0, pageSize).map(fromOrderDocument);
    const last = orders.at(-1);
    const next = documents.length > pageSize && last !== undefined ? cursorOf(last) : undefined;
    return { orders, next };
  }

  hasPaidOrder(userId: string): Promise<boolean> {
    return this.orders.existsWithStatus(userId, PAID_ORDER_STATUSES);
  }

  async riskHistory(userId: string): Promise<RiskHistory> {
    const byStatus = await this.orders.countAndSumByStatus(
      userId,
      [ORDER_STATUS.DELIVERED, ORDER_STATUS.CANCELLED],
      // Sistemin taslak iptalleri kullanici davranisi degil (T11.2).
      { excludeCancellationNotes: SYSTEM_CANCELLATION_NOTES },
    );
    const delivered = byStatus.get(ORDER_STATUS.DELIVERED);
    return toRiskHistory(
      delivered?.count ?? 0,
      byStatus.get(ORDER_STATUS.CANCELLED)?.count ?? 0,
      delivered?.totalMinor ?? 0,
    );
  }

  async findExpiredReservations(now: Date, limit: number): Promise<readonly Order[]> {
    const documents = await this.orders.findExpiredReservations(EXPIRY_SWEPT_STATUSES, now, limit);
    return documents.map(fromOrderDocument);
  }

  async findAwaitingCourier(now: Date, limit: number): Promise<readonly Order[]> {
    const documents = await this.orders.findAwaitingCourier(now, limit);
    return documents.map(fromOrderDocument);
  }
}
