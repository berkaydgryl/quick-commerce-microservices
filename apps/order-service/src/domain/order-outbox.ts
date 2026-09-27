/**
 * Outbox'in YAYIN tarafi portu (T7.3, ADR-04). Olaylarin siparisle birlikte
 * yazilmasi OrderRepository'dedir (ayni transaction); burasi yayinlanmamis
 * olaylari okur, isaretler ve siparis degismeden olay ekler (telafi komutu).
 *
 * Uygulamalari: bellek (MOCK) ve Mongo (`outbox` koleksiyonu). Ikisi ayni
 * sozlesme testinden gecer (test/support/order-outbox-contract.ts).
 */

import type { OrderEvent } from './order-events.js';

export interface OrderOutbox {
  /** Siparis degismeden olay yazar (orn. payment.refund_requested). */
  append(events: readonly OrderEvent[]): Promise<void>;

  /**
   * Yayinlanmamis olaylar, YAYIN SIRASIYLA: olus zamani, esitlikte siparis
   * surumu. En fazla `limit` tane.
   */
  pending(limit: number): Promise<readonly OrderEvent[]>;

  /** Olaylari yayinlandi isaretler; zaten isaretli olana dokunmaz. */
  markPublished(eventIds: readonly string[], at: Date): Promise<void>;
}
