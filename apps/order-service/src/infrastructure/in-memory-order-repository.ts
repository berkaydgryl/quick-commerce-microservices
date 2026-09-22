/**
 * Siparis deposunun BELLEK uygulamasi (T3.2).
 *
 * Mongo uygulamasi T4.5'te gelecek. Bellekte tutmanin bilincli bedeli:
 * process yeniden baslayinca taslaklar kaybolur. Bugun bu kabul edilebilir,
 * cunku servis henuz hicbir kalici soz vermiyor - grpcurl ile ucu denemek
 * icin yeterli.
 */

import type { OrderRepository } from '../domain/order-repository.js';
import type { Order } from '../domain/order.js';

export class InMemoryOrderRepository implements OrderRepository {
  private readonly orders = new Map<string, Order>();

  save(order: Order): Promise<void> {
    this.orders.set(order.id, order);
    return Promise.resolve();
  }

  findById(orderId: string): Promise<Order | null> {
    return Promise.resolve(this.orders.get(orderId) ?? null);
  }

  /** Yalnizca test icin: kayitli siparis sayisi. */
  get size(): number {
    return this.orders.size;
  }
}
