/**
 * Siparis deposunun BELLEK uygulamasi (MOCK=true).
 *
 * Mongo uygulamasiyla AYNI sozlesme testinden gecer: surum kontrolu, sahiplik
 * ve gecmis sirasi bellekte de ayni davranir. Bedeli bilinclidir: process
 * yeniden baslayinca siparisler kaybolur - veritabani kurmadan calismak
 * isteyen frontend ve birim testleri icindir.
 */

import { comesBefore, cursorOf } from '../../domain/order-history-cursor.js';
import type {
  OrderHistoryPage,
  OrderHistoryQuery,
  OrderHistoryReader,
} from '../../domain/order-history-reader.js';
import type { OrderRepository } from '../../domain/order-repository.js';
import { orderAlreadyExists, orderVersionConflict } from '../../domain/order-repository.js';
import type { Order } from '../../domain/order.js';

export class InMemoryOrderStore implements OrderRepository, OrderHistoryReader {
  private readonly orders = new Map<string, Order>();

  insert(order: Order): Promise<void> {
    if (this.orders.has(order.id)) {
      return Promise.reject(orderAlreadyExists(order.id));
    }
    this.orders.set(order.id, order);
    return Promise.resolve();
  }

  update(order: Order, expectedVersion: number): Promise<void> {
    if (this.orders.get(order.id)?.version !== expectedVersion) {
      return Promise.reject(orderVersionConflict(order.id, expectedVersion));
    }
    this.orders.set(order.id, order);
    return Promise.resolve();
  }

  findById(orderId: string): Promise<Order | null> {
    return Promise.resolve(this.orders.get(orderId) ?? null);
  }

  listByUser({ userId, pageSize, after }: OrderHistoryQuery): Promise<OrderHistoryPage> {
    const matching = [...this.orders.values()]
      .filter((order) => order.userId === userId)
      .filter((order) => after === undefined || comesBefore(after, cursorOf(order)))
      .sort((left, right) => (comesBefore(cursorOf(left), cursorOf(right)) ? -1 : 1));

    const orders = matching.slice(0, pageSize);
    const last = orders.at(-1);
    const next = matching.length > pageSize && last !== undefined ? cursorOf(last) : undefined;
    return Promise.resolve({ orders, next });
  }

  /** Yalnizca test icin: kayitli siparis sayisi. */
  get size(): number {
    return this.orders.size;
  }
}
