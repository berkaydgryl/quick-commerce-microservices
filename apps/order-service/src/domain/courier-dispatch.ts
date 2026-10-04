/**
 * Odenen siparise kurye atama kurallari (T13.1 PR 2). Saf: courier-service'e
 * bakmaz, yalnizca karar verir ve siparisin yeni halini kurar.
 *
 * Akis (roadmap saga tablosu, AssignCourier satiri; B7):
 *   PAID ------------- kurye atandi ---> PREPARING, kuryeyle (tek yazim, tek gecis)
 *   PAID ------------- uygun kurye yok -> PREPARING, kuryesiz + courierRetryAt
 *   kuryesiz PREPARING  deneme ani geldi -> ayni durum; kurye ya da yeni deneme ani
 *
 * Durum disi guncelleme (kuryesiz PREPARING'e kurye ya da yeni deneme ani) de
 * SURUMU bir artirir (rescheduleReservation ile ayni kural): iki order ornegi
 * ayni siparisi yazarken biri digerinin yazimini sessizce ezmesin. Zaman
 * cizelgesine kayit eklenmez, olay uretilmez; soket `seq`'i bu yuzden bosluklu
 * ilerleyebilir (docs/api/socket-events.md "seq").
 */

import { AppError, ERROR_CODES, ORDER_STATUS } from '@getir/core';
import type { Clock, OrderStatus } from '@getir/core';

import { isTerminal } from './order-state-machine.js';
import type { Order } from './order.js';
import { transitionOrder } from './order.js';

/** Kurye bekleyebilen durumlar: iscinin is kuyrugu (Mongo kismi indeksi de bunlar). */
export const COURIER_DISPATCH_STATUSES: readonly OrderStatus[] = [
  ORDER_STATUS.PAID,
  ORDER_STATUS.PREPARING,
];

/**
 * Siparise kurye yazilabilir mi: odenmis (PAID) ya da kuryesiz PREPARING.
 * Deneme anina bakmaz; isci bir kuryeyi zaten almissa yazmak icin beklemez.
 */
export function needsCourier(order: Order): boolean {
  return (
    order.status === ORDER_STATUS.PAID ||
    (order.status === ORDER_STATUS.PREPARING && order.courier === undefined)
  );
}

/**
 * Isci bu siparise `now` itibariyla kurye istemeli mi? Odenmis siparis hemen;
 * kuryesiz PREPARING deneme ani gelince. Deneme ani olmayan kuryesiz PREPARING
 * (bu gorevden onceki kayit) isciye girmez.
 */
export function isCourierDue(order: Order, now: Date): boolean {
  if (order.status === ORDER_STATUS.PAID) {
    return true;
  }
  return (
    needsCourier(order) &&
    order.courierRetryAt !== undefined &&
    order.courierRetryAt.getTime() <= now.getTime()
  );
}

/**
 * Atamasi yazilamayan siparisin kuryesi geri verilmeli mi (QA T3)? Son durumdaki
 * siparis (iptal, ret, teslim) kurye tutmaz. Diger durumlarda siparis ya hala
 * kurye bekler (sonraki deneme ayni kuryeyi alir) ya da kuryesi yazilmistir.
 */
export function releasesCourier(order: Order): boolean {
  return isTerminal(order.status);
}

/**
 * Kurye atandi: PAID ise PREPARING'e gecer (zaman cizelgesi + olay), kuryesiz
 * PREPARING ise yalnizca kurye yazilir. Deneme ani silinir.
 * @throws AppError ORDER_STATE_INVALID - siparis kurye beklemiyor.
 */
export function withAssignedCourier(order: Order, courierId: string, clock: Clock): Order {
  const { courierRetryAt: _cleared, ...next } = advance(order, clock);
  return { ...next, courier: { courierId, assignedAt: next.updatedAt } };
}

/**
 * Uygun kurye yok: PAID ise yine PREPARING'e gecer (market hazirlamaya baslar),
 * kurye `retryAt`'ten sonra yeniden istenir.
 * @throws AppError ORDER_STATE_INVALID - siparis kurye beklemiyor.
 */
export function withCourierRetry(order: Order, retryAt: Date, clock: Clock): Order {
  return { ...advance(order, clock), courierRetryAt: retryAt };
}

/** PAID -> PREPARING gecisi ya da kuryesiz PREPARING'in durum disi guncellemesi. */
function advance(order: Order, clock: Clock): Order {
  if (!needsCourier(order)) {
    throw new AppError(ERROR_CODES.ORDER_STATE_INVALID, 'Siparis kurye beklemiyor', {
      details: { orderId: order.id, status: order.status },
    });
  }
  if (order.status === ORDER_STATUS.PAID) {
    return transitionOrder(order, ORDER_STATUS.PREPARING, clock);
  }
  return { ...order, updatedAt: clock.date(), version: order.version + 1 };
}
