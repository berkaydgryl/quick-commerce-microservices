/**
 * Outbox'in YAYIN tarafi portu (T7.3, ADR-04). Olaylarin siparisle birlikte
 * yazilmasi OrderRepository'dedir (ayni transaction); burasi yayinlanmamis
 * olaylari okur, isaretler ve siparis degismeden olay ekler (telafi komutu).
 * Her yazim, yazan istegin izini (D16) olayin yanina saklar.
 *
 * Uygulamalari: bellek (MOCK) ve Mongo (`outbox` koleksiyonu). Ikisi ayni
 * sozlesme testinden gecer (test/support/order-outbox-contract.ts).
 */

import type { OrderEvent } from './order-events.js';

/**
 * Olayi yazan istegin izi (D16): kimligi ve iz baglami. Yazim aninda istegin
 * baglamindan altyapi alir (domain uretmez); yayinda zarfa kopyalanir, tuketici
 * ayni izde ve ayni requestId ile isler. Istek disi yazimda (seed) yoktur.
 */
export interface EventCorrelation {
  readonly requestId?: string;
  readonly traceparent?: string;
}

/** Yayin bekleyen olay; yazan istegin izi varsa onunla. */
export interface PendingEvent extends OrderEvent {
  readonly correlation?: EventCorrelation;
}

/** Yazim aninda istegin izini veren kaynak (uretimde aktif baglam: observability). */
export type CorrelationSource = () => EventCorrelation;

export interface OrderOutbox {
  /** Siparis degismeden olay yazar (orn. payment.refund_requested). */
  append(events: readonly OrderEvent[]): Promise<void>;

  /**
   * Yayinlanmamis olaylar, YAYIN SIRASIYLA: olus zamani, esitlikte siparis
   * surumu. En fazla `limit` tane.
   */
  pending(limit: number): Promise<readonly PendingEvent[]>;

  /** Olaylari yayinlandi isaretler; zaten isaretli olana dokunmaz. */
  markPublished(eventIds: readonly string[], at: Date): Promise<void>;
}
