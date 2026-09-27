/**
 * Siparis portlarinin Mongo uygulamasi: domain <-> belge cevirisi ve depo
 * sozlesmesinin hatalari. Sorgu yazmaz; sorgular orders-collection.ts'tedir.
 *
 * Bellek uygulamasiyla ayni sozlesme testinden gecer
 * (test/support/order-repository-contract.ts).
 */

import { ERROR_CODES, isAppError, ORDER_STATUS } from '@getir/core';

import { cursorOf } from '../../domain/order-history-cursor.js';
import type {
  OrderHistoryPage,
  OrderHistoryQuery,
  OrderHistoryReader,
  RiskHistory,
} from '../../domain/order-history-reader.js';
import { PAID_ORDER_STATUSES, toRiskHistory } from '../../domain/order-history-reader.js';
import type { OrderRepository } from '../../domain/order-repository.js';
import { orderAlreadyExists, orderVersionConflict } from '../../domain/order-repository.js';
import type { Order } from '../../domain/order.js';
import { fromOrderDocument, toOrderDocument } from './mappers.js';
import type { OrdersCollection } from './orders-collection.js';

export class OrderMongoStore implements OrderRepository, OrderHistoryReader {
  constructor(private readonly orders: OrdersCollection) {}

  async insert(order: Order): Promise<void> {
    try {
      await this.orders.insertOne(toOrderDocument(order));
    } catch (error: unknown) {
      // mongo-kit tekil ihlali CONFLICT'e cevirir; _id tekrarinda depo
      // sozlesmesinin hatasini veriyoruz (bellek uygulamasiyla ayni ayrinti).
      throw isAppError(error) && error.code === ERROR_CODES.CONFLICT
        ? orderAlreadyExists(order.id)
        : error;
    }
  }

  async update(order: Order, expectedVersion: number): Promise<void> {
    const replaced = await this.orders.replaceIfVersion(toOrderDocument(order), expectedVersion);
    if (!replaced) {
      throw orderVersionConflict(order.id, expectedVersion);
    }
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
    const byStatus = await this.orders.countAndSumByStatus(userId, [
      ORDER_STATUS.DELIVERED,
      ORDER_STATUS.CANCELLED,
    ]);
    const delivered = byStatus.get(ORDER_STATUS.DELIVERED);
    return toRiskHistory(
      delivered?.count ?? 0,
      byStatus.get(ORDER_STATUS.CANCELLED)?.count ?? 0,
      delivered?.totalMinor ?? 0,
    );
  }
}
