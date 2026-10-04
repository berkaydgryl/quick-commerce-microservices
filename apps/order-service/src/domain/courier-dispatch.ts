/**
 * Odenen siparise kurye atama kurallari (T13.1 PR 2). Saf: courier-service'e
 * bakmaz, yalnizca karar verir ve siparisin yeni halini kurar.
 *
 * Akis (roadmap saga tablosu, AssignCourier satiri; B7):
 *   PAID ------------- kurye atandi ---> PREPARING, kuryeyle (tek yazim, tek gecis)
 *   PAID ------------- uygun kurye yok -> PREPARING, kuryesiz + courierRetryAt
 *   kuryesiz PREPARING  deneme ani geldi -> ayni durum; kurye ya da yeni deneme ani
 *
 * Kuyruk sirasi (#92, T13.2): kurye bekleyenler ODEME ANINA gore (courierQueuedAt,
 * esitlikte kimlik) denenir. Turda kurye istenecek en az bir siparis varsa
 * (yeni odeme ya da deneme ani gelmis), ondan ONCE odemis kuryesiz bekleyenler
 * de ayni turda ve ondan once denenir: bosalan kurye, ona ulasabilen en eski
 * siparise gider. Yeni talep yoksa bekleyenler 30 sn kuralini surdurur.
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
 * Kuryesiz bekleyen mi: iscinin "kurye yok" yazdigi (deneme ani olan) kuryesiz
 * PREPARING. Deneme ani gelmemis olsa da kuyruktadir; isCourierDue'nun disladigi
 * eski kayitlar (deneme ani yok) burada da yok.
 */
export function isWaitingForCourier(order: Order): boolean {
  return (
    order.status === ORDER_STATUS.PREPARING &&
    order.courier === undefined &&
    order.courierRetryAt !== undefined
  );
}

/**
 * Siparisin kurye kuyrugundaki ani: courierQueuedAt; yoksa (alan oncesi kayit)
 * zaman cizelgesindeki odeme ani, o da yoksa olusturma ani.
 */
export function courierQueueTime(order: Order): Date {
  return (
    order.courierQueuedAt ??
    order.timeline.find((entry) => entry.status === ORDER_STATUS.PAID)?.at ??
    order.createdAt
  );
}

/** Kuyruk sirasi: once odeyen once, esitlikte kimlik (Mongo sorgusuyla ayni). */
export function compareCourierQueue(left: Order, right: Order): number {
  const byQueue = courierQueueTime(left).getTime() - courierQueueTime(right).getTime();
  if (byQueue !== 0) {
    return byQueue;
  }
  if (left.id === right.id) {
    return 0;
  }
  return left.id < right.id ? -1 : 1;
}

/**
 * Turun kuyrugu (#92): kurye istenecekler (`due`) ve onlardan once odemis
 * kuryesiz bekleyenler (`waiting`), tekrarsiz, kuyruk sirasiyla. `due` bossa
 * tur yoktur: bekleyenler kendi deneme anlarini bekler.
 */
export function courierQueue(due: readonly Order[], waiting: readonly Order[]): Order[] {
  if (due.length === 0) {
    return [];
  }
  const byId = new Map<string, Order>();
  for (const order of [...due, ...waiting]) {
    byId.set(order.id, order);
  }
  return [...byId.values()].sort(compareCourierQueue);
}

/** Bekleyenlerin sinir ani: `due` icindeki en gec odeme; ondan once odeyenler one gecer. */
export function latestQueueTime(due: readonly Order[]): Date | undefined {
  let latest: Date | undefined;
  for (const order of due) {
    const at = courierQueueTime(order);
    if (latest === undefined || at.getTime() > latest.getTime()) {
      latest = at;
    }
  }
  return latest;
}

/**
 * Odenen siparisi kurye kuyruguna yazar (#92): odeme ani, PAID gecisinin ani.
 * Odeme adimi PAID'e gecirdigi kayda uygular.
 */
export function queuedForCourier(paid: Order): Order {
  return { ...paid, courierQueuedAt: paid.updatedAt };
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
 * PREPARING ise yalnizca kurye yazilir. Deneme ani ve kuyruk ani silinir.
 * @throws AppError ORDER_STATE_INVALID - siparis kurye beklemiyor.
 */
export function withAssignedCourier(order: Order, courierId: string, clock: Clock): Order {
  const {
    courierRetryAt: _retryCleared,
    courierQueuedAt: _queueCleared,
    ...next
  } = advance(order, clock);
  return { ...next, courier: { courierId, assignedAt: next.updatedAt } };
}

/**
 * Uygun kurye yok: PAID ise yine PREPARING'e gecer (market hazirlamaya baslar),
 * kurye `retryAt`'ten sonra yeniden istenir. Kuyruk ani korunur; alan oncesi
 * kayitta odeme anindan yazilir (bekleyenler kuyruga onunla girer).
 * @throws AppError ORDER_STATE_INVALID - siparis kurye beklemiyor.
 */
export function withCourierRetry(order: Order, retryAt: Date, clock: Clock): Order {
  return {
    ...advance(order, clock),
    courierRetryAt: retryAt,
    courierQueuedAt: courierQueueTime(order),
  };
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
