/**
 * Siparis deposunun ARAYUZU (port).
 *
 * Uygulamasi bugun bellekte (infrastructure/in-memory-order-repository.ts),
 * T4.5'te Mongo olacak. Use-case'ler bu arayuzu gordugu icin o gun
 * degismeyecek.
 */

import type { Order } from './order.js';

export interface OrderRepository {
  /** Siparisi kaydeder; ayni kimlik varsa uzerine yazar. */
  save(order: Order): Promise<void>;
  /** Kimlige gore okur; yoksa null. */
  findById(orderId: string): Promise<Order | null>;
}
