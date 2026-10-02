/**
 * Siparisin urettigi olaylar (T7.3, ADR-04): saf, I/O yok.
 *
 * Olaylar siparisin ONCEKI ve SONRAKI halinden turetilir; her yazma noktasi
 * ayni fonksiyonu kullanir, olay bicimi tek yerde durur. Zarfa (ADR-07)
 * ceviri yayinda yapilir (application/relay-outbox.ts): domain olay hattinin
 * tasima bicimini bilmez.
 *
 *   order.created         taslak acildiginda (B8: siparis kimligi burada dogar)
 *   order.status_changed  her durum gecisinde, gecis basina BIR olay
 *   payment.cancel_requested  iptal komutu: siparis odeme asamasindan CANCELLED'a
 *                         gecti; status_changed ile AYNI yazimda (T11.2 PR 3)
 *   payment.refund_requested  telafi komutu: iade dogrudan yapilamadi (T7.1 borcu)
 */

import type { PaymentCancelRequestedPayload, RefundRequestedPayload } from '@getir/contracts';
import { EVENTS, ID_PREFIX, newId, ORDER_STATUS } from '@getir/core';
import type { EventName, OrderStatus } from '@getir/core';

import type { Order } from './order.js';

export interface OrderEvent {
  /** evt_<32 hex>; tuketici bununla tekillestirir (teslimat en az bir kez). */
  readonly eventId: string;
  readonly topic: EventName;
  /** Olayin ait oldugu siparis: bolum anahtari (partitionKey). */
  readonly orderId: string;
  /**
   * Olayin siparise getirdigi surum. Ayni siparisin olaylari bu siraya gore
   * yayinlanir; realtime soket olayinin `seq`'i olarak kullanabilir.
   */
  readonly version: number;
  readonly occurredAt: Date;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** Yeni taslagin olayi. */
export function orderCreatedEvents(order: Order): readonly OrderEvent[] {
  return [
    {
      eventId: newId(ID_PREFIX.EVENT),
      topic: EVENTS.ORDER_CREATED,
      orderId: order.id,
      version: order.version,
      occurredAt: order.createdAt,
      payload: {
        orderId: order.id,
        userId: order.userId,
        marketId: order.marketId,
        status: order.status,
        totalMinor: order.pricing.totalMinor,
        currency: order.pricing.currency,
        version: order.version,
      },
    },
  ];
}

/**
 * Iptal komutunun gerekcesi: payment kayda yazar (iade gerekcesiyle ayni
 * anahtar kurali). Siparisin iptal sebebi order.status_changed'in notundadir.
 */
export const PAYMENT_CANCEL_REASON = 'order_cancelled';

/**
 * Odemesi olabilecek durumlar: siparis bunlardan CANCELLED'a gecerse payment'a
 * iptal komutu gider (T11.2 PR 3). Order odeme yontemini bilmez; tahsil
 * edilmemis odemeyi (kapida odeme, 3DS bekleyen) kapatma karari payment'ta.
 */
const PAYMENT_STAGE_STATUSES: readonly OrderStatus[] = [
  ORDER_STATUS.AWAITING_PAYMENT,
  ORDER_STATUS.PAID,
];

/**
 * `before`'dan `after`'a gecerken eklenen her zaman cizelgesi kaydi icin bir
 * order.status_changed. Tek yazimda birden fazla gecis olabilir (risk adimi:
 * RISK_CHECK -> RESERVED -> AWAITING_PAYMENT); tuketici her adimi gorur.
 *
 * Odeme asamasindan CANCELLED'a gecis ayrica payment.cancel_requested uretir:
 * iptal eden HER yazim (kullanici, supurucu, kilidi dusmus odeme) bu fonksiyonu
 * kullandigi icin hicbir yol komutu unutmaz; komut siparisle ayni yazimdadir.
 */
export function statusChangedEvents(before: Order, after: Order): readonly OrderEvent[] {
  const added = after.timeline.slice(before.timeline.length);
  return added.flatMap((entry, index) => {
    const previous = after.timeline[before.timeline.length + index - 1];
    const version = before.version + index + 1;
    const changed: OrderEvent = {
      eventId: newId(ID_PREFIX.EVENT),
      topic: EVENTS.ORDER_STATUS_CHANGED,
      orderId: after.id,
      version,
      occurredAt: entry.at,
      payload: {
        orderId: after.id,
        userId: after.userId,
        marketId: after.marketId,
        ...(previous === undefined ? {} : { from: previous.status }),
        to: entry.status,
        ...(entry.note === undefined ? {} : { note: entry.note }),
        version,
      },
    };
    const cancelsPayment =
      entry.status === ORDER_STATUS.CANCELLED &&
      previous !== undefined &&
      PAYMENT_STAGE_STATUSES.includes(previous.status);
    return cancelsPayment
      ? [changed, paymentCancelRequestedEvent(after.id, version, entry.at)]
      : [changed];
  });
}

function paymentCancelRequestedEvent(orderId: string, version: number, at: Date): OrderEvent {
  const payload: PaymentCancelRequestedPayload = { orderId, reason: PAYMENT_CANCEL_REASON };
  return {
    eventId: newId(ID_PREFIX.EVENT),
    topic: EVENTS.PAYMENT_CANCEL_REQUESTED,
    orderId,
    version,
    occurredAt: at,
    payload,
  };
}

export interface RefundRequest {
  /** Gerekce anahtari (payment-svc kayda yazar). */
  readonly reason: string;
  /** Siparisten turetilen iade anahtari: tekrar gelen komut ikinci kez iade etmez. */
  readonly idempotencyKey: string;
}

/**
 * Telafi komutu: tutar alindi, siparis PAID yazilamadi ve dogrudan iade de
 * basarisiz oldu. Siparis DEGISMEDEN outbox'a yazilir; payment-svc dinler (T7.4).
 * Govde sozlesme tipindedir (@getir/contracts): payment ayni semayla dogrular,
 * alan adi burada degisirse derleme kirilir.
 */
export function refundRequestedEvent(
  order: Pick<Order, 'id' | 'version'>,
  request: RefundRequest,
  at: Date,
): OrderEvent {
  const payload: RefundRequestedPayload = {
    orderId: order.id,
    reason: request.reason,
    idempotencyKey: request.idempotencyKey,
  };
  return {
    eventId: newId(ID_PREFIX.EVENT),
    topic: EVENTS.PAYMENT_REFUND_REQUESTED,
    orderId: order.id,
    version: order.version,
    occurredAt: at,
    payload,
  };
}
