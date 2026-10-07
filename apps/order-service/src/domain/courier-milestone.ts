/**
 * Kurye kilometre taslari (T14.3): courier.picked_up ve courier.delivered
 * olaylarinin siparise etkisi. Saf: olay hattini ve depoyu bilmez, yalnizca
 * karar verir ve siparisin yeni halini kurar.
 *
 * Olaylar EN AZ BIR KEZ ve SIRASIZ gelir (@getir/contracts events.ts): ayni
 * olay tekrar edebilir, delivered picked_up'tan once islenebilir. Karar bu
 * yuzden siparisin SU ANKI durumundan verilir:
 *
 *   PREPARING  + picked_up -> ON_THE_WAY
 *   PREPARING  + delivered -> ON_THE_WAY, DELIVERED (iki gecis, tek yazim)
 *   ON_THE_WAY + delivered -> DELIVERED
 *   hedefte ya da ilerisinde                    -> tekrar (yok sayilir)
 *   kurye henuz yazilmamis (PAID, kuryesiz PREPARING) -> HENUZ DEGIL: olay
 *       onaylanmaz, yeniden teslim edilir; yok sayilsaydi bir daha gelmezdi
 *   kurye siparisin kuryesi degil; picked_up'ta market de -> eski olay (yok sayilir)
 *   odeme oncesi ya da kapanmis siparis (CANCELLED, REJECTED...) -> yok sayilir
 *
 * Gecisin ani olayin anidir (zarfin occurredAt'i: kuryenin paketi aldigi ya da
 * teslim ettigi an); yeniden teslim ya da gecikme zaman cizelgesini kaydirmaz.
 * Simdiden ileri ve cizelgenin son kaydindan geri olamaz (milestoneTime).
 */

import { ORDER_STATUS } from '@getir/core';
import type { Clock, OrderStatus } from '@getir/core';

import { needsCourier } from './courier-dispatch.js';
import type { Order } from './order.js';
import { transitionOrder } from './order.js';

export const COURIER_MILESTONE = {
  PICKED_UP: 'PICKED_UP',
  DELIVERED: 'DELIVERED',
} as const;

export type CourierMilestoneKind = (typeof COURIER_MILESTONE)[keyof typeof COURIER_MILESTONE];

/** Olayin siparisle karsilastirilan alanlari (yukun dogrulanmis hali). */
export type CourierMilestone =
  | {
      readonly kind: typeof COURIER_MILESTONE.PICKED_UP;
      readonly courierId: string;
      readonly marketId: string;
    }
  | { readonly kind: typeof COURIER_MILESTONE.DELIVERED; readonly courierId: string };

/** Eski olayin hangi alani siparise uymadi. */
export type StaleField = 'courier' | 'market';

export type MilestoneDecision =
  | { readonly kind: 'APPLY'; readonly steps: readonly OrderStatus[] }
  | { readonly kind: 'NOT_YET' }
  | { readonly kind: 'STALE'; readonly field: StaleField }
  | { readonly kind: 'DUPLICATE' }
  | { readonly kind: 'IGNORED' };

/**
 * Durum kurye olaylarini bekler mi: odenmis ve sonrasi evet; odeme oncesi ve
 * kapanmis (iptal, ret, sure doldu, odeme hatasi) hayir. Yeni durum eklenirse
 * derleme karar ister.
 */
const EXPECTS_COURIER_EVENTS: Readonly<Record<OrderStatus, boolean>> = {
  [ORDER_STATUS.DRAFT]: false,
  [ORDER_STATUS.RISK_CHECK]: false,
  [ORDER_STATUS.REVIEW]: false,
  [ORDER_STATUS.RESERVED]: false,
  [ORDER_STATUS.AWAITING_PAYMENT]: false,
  [ORDER_STATUS.PAID]: true,
  [ORDER_STATUS.PREPARING]: true,
  [ORDER_STATUS.ON_THE_WAY]: true,
  [ORDER_STATUS.DELIVERED]: true,
  [ORDER_STATUS.PAYMENT_FAILED]: false,
  [ORDER_STATUS.EXPIRED]: false,
  [ORDER_STATUS.CANCELLED]: false,
  [ORDER_STATUS.REJECTED]: false,
};

/** Kilometre tasinin durum basina gecisleri; tabloda olmayan durum hedefte ya da ilerisinde. */
const MILESTONE_STEPS: Readonly<
  Record<CourierMilestoneKind, Partial<Record<OrderStatus, readonly OrderStatus[]>>>
> = {
  [COURIER_MILESTONE.PICKED_UP]: {
    [ORDER_STATUS.PREPARING]: [ORDER_STATUS.ON_THE_WAY],
  },
  [COURIER_MILESTONE.DELIVERED]: {
    [ORDER_STATUS.PREPARING]: [ORDER_STATUS.ON_THE_WAY, ORDER_STATUS.DELIVERED],
    [ORDER_STATUS.ON_THE_WAY]: [ORDER_STATUS.DELIVERED],
  },
};

/** Olay siparise ne yapar? */
export function decideMilestone(order: Order, milestone: CourierMilestone): MilestoneDecision {
  if (!EXPECTS_COURIER_EVENTS[order.status]) {
    return { kind: 'IGNORED' };
  }
  if (needsCourier(order)) {
    return { kind: 'NOT_YET' };
  }
  if (order.courier?.courierId !== milestone.courierId) {
    return { kind: 'STALE', field: 'courier' };
  }
  if (milestone.kind === COURIER_MILESTONE.PICKED_UP && milestone.marketId !== order.marketId) {
    return { kind: 'STALE', field: 'market' };
  }
  const steps = MILESTONE_STEPS[milestone.kind][order.status];
  return steps === undefined ? { kind: 'DUPLICATE' } : { kind: 'APPLY', steps };
}

/**
 * Gecislerin ani: olayin ani; simdiden ileri gidemez (saat farki) ve zaman
 * cizelgesinin son kaydindan geri gidemez (cizelge sirali kalir). Gecersiz an
 * gelirse simdi.
 */
export function milestoneTime(order: Order, occurredAt: Date, now: Date): Date {
  const occurred = occurredAt.getTime();
  const bounded = Number.isNaN(occurred) ? now.getTime() : Math.min(occurred, now.getTime());
  const last = order.timeline.at(-1)?.at.getTime() ?? order.createdAt.getTime();
  return new Date(Math.max(bounded, last));
}

/** Kararin gecislerini `at` aninda sirayla uygular (her biri tablodan gecer, cizelgeye eklenir). */
export function advanceOrder(order: Order, steps: readonly OrderStatus[], at: Date): Order {
  const clock: Clock = { now: () => at.getTime(), date: () => new Date(at.getTime()) };
  return steps.reduce((current, status) => transitionOrder(current, status, clock), order);
}
