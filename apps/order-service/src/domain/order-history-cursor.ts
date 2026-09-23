/**
 * Siparis gecmisi sayfalamasinin saf kurallari: sira ve imlec.
 *
 * IMLEC NEDEN (createdAt, id): liste yeniden eskiye siralidir ve kimlikler
 * rastgeledir (ord_ + 32 hex) - kimlik tek basina zaman sirasi vermez. Ayni
 * milisaniyede iki siparis olabilecegi icin kimlik esitlik bozucudur. Iki alan
 * da siparis omru boyunca DEGISMEZ, bu yuzden imlec kaymaz.
 *
 * Imlecin istemciye giden OPAK metin bicimi bir tel (sozlesme) konusudur ve
 * interfaces/grpc/page-token.ts'tedir; burada yalnizca SIRA kurali var.
 */

import type { Order } from './order.js';

export interface OrderHistoryCursor {
  readonly createdAt: Date;
  readonly orderId: string;
}

/** Gecmis sirasi: `left`, `right`'tan ONCE listelenir mi? (yeniden eskiye) */
export function comesBefore(left: OrderHistoryCursor, right: OrderHistoryCursor): boolean {
  const byTime = left.createdAt.getTime() - right.createdAt.getTime();
  return byTime === 0 ? left.orderId > right.orderId : byTime > 0;
}

export function cursorOf(order: Order): OrderHistoryCursor {
  return { createdAt: order.createdAt, orderId: order.id };
}
