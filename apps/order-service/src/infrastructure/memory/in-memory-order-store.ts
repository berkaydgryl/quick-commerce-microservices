/**
 * Siparis deposunun BELLEK uygulamasi (MOCK=true).
 *
 * Mongo uygulamasiyla AYNI sozlesme testinden gecer: surum kontrolu, sahiplik
 * ve gecmis sirasi bellekte de ayni davranir. Bedeli bilinclidir: process
 * yeniden baslayinca siparisler kaybolur - veritabani kurmadan calismak
 * isteyen frontend ve birim testleri icindir.
 */

import { AppError, ORDER_STATUS } from '@getir/core';
import { currentCorrelation } from '@getir/observability';

import type { OrderEvent } from '../../domain/order-events.js';
import { comesBefore, cursorOf } from '../../domain/order-history-cursor.js';
import type {
  OrderHistoryPage,
  OrderHistoryQuery,
  OrderHistoryReader,
  RiskHistory,
} from '../../domain/order-history-reader.js';
import { PAID_ORDER_STATUSES, toRiskHistory } from '../../domain/order-history-reader.js';
import type {
  CorrelationSource,
  EventCorrelation,
  OrderOutbox,
  PendingEvent,
} from '../../domain/order-outbox.js';
import type { OrderRepository } from '../../domain/order-repository.js';
import { orderAlreadyExists, orderVersionConflict } from '../../domain/order-repository.js';
import type { Order } from '../../domain/order.js';

interface StoredEvent {
  readonly event: OrderEvent;
  /** Yazan istegin izi (D16); Mongo'daki iki istege bagli alanin karsiligi. */
  readonly correlation: EventCorrelation;
  publishedAt?: Date;
}

export class InMemoryOrderStore implements OrderRepository, OrderHistoryReader, OrderOutbox {
  private readonly orders = new Map<string, Order>();
  private readonly events: StoredEvent[] = [];

  constructor(private readonly correlation: CorrelationSource = currentCorrelation) {}

  // Siparis ve olaylari ayni senkron adimda yazilir: arada baska kod kosamaz,
  // bellekte "transaction" budur. Hata halinde ikisi de yazilmaz.
  insert(order: Order, events: readonly OrderEvent[]): Promise<void> {
    if (this.orders.has(order.id)) {
      return Promise.reject(orderAlreadyExists(order.id));
    }
    const duplicate = this.duplicateEvent(events);
    if (duplicate !== undefined) {
      return Promise.reject(duplicate);
    }
    this.orders.set(order.id, order);
    this.record(events);
    return Promise.resolve();
  }

  update(order: Order, expectedVersion: number, events: readonly OrderEvent[]): Promise<void> {
    if (this.orders.get(order.id)?.version !== expectedVersion) {
      return Promise.reject(orderVersionConflict(order.id, expectedVersion));
    }
    const duplicate = this.duplicateEvent(events);
    if (duplicate !== undefined) {
      return Promise.reject(duplicate);
    }
    this.orders.set(order.id, order);
    this.record(events);
    return Promise.resolve();
  }

  append(events: readonly OrderEvent[]): Promise<void> {
    const duplicate = this.duplicateEvent(events);
    if (duplicate !== undefined) {
      return Promise.reject(duplicate);
    }
    this.record(events);
    return Promise.resolve();
  }

  pending(limit: number): Promise<readonly PendingEvent[]> {
    const unpublished = this.events
      .filter((stored) => stored.publishedAt === undefined)
      .map(toPendingEvent)
      .sort(
        (left, right) =>
          left.occurredAt.getTime() - right.occurredAt.getTime() || left.version - right.version,
      );
    return Promise.resolve(unpublished.slice(0, limit));
  }

  markPublished(eventIds: readonly string[], at: Date): Promise<void> {
    const ids = new Set(eventIds);
    for (const stored of this.events) {
      if (ids.has(stored.event.eventId) && stored.publishedAt === undefined) {
        stored.publishedAt = at;
      }
    }
    return Promise.resolve();
  }

  /** Yalnizca test icin: yazilan TUM olaylar (yayinlanmis olanlar dahil), yazim sirasiyla. */
  get recordedEvents(): readonly OrderEvent[] {
    return this.events.map((stored) => stored.event);
  }

  /**
   * Mongo'daki outbox _id tekilligiyle ayni kural: ayni olay kimligi ikinci
   * kez yazilamaz. Kontrol siparise DOKUNMADAN once yapilir; boylece bellekte
   * de "biri yazilmazsa digeri de yazilmaz" gecerlidir.
   */
  private duplicateEvent(events: readonly OrderEvent[]): AppError | undefined {
    const known = new Set(this.events.map((stored) => stored.event.eventId));
    const clash = events.find((event) => known.has(event.eventId));
    return clash === undefined
      ? undefined
      : AppError.conflict('Olay zaten yazilmis', { details: { eventId: clash.eventId } });
  }

  private record(events: readonly OrderEvent[]): void {
    const correlation = this.correlation();
    this.events.push(...events.map((event) => ({ event, correlation })));
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

  hasPaidOrder(userId: string): Promise<boolean> {
    return Promise.resolve(
      [...this.orders.values()].some(
        (order) => order.userId === userId && PAID_ORDER_STATUSES.includes(order.status),
      ),
    );
  }

  riskHistory(userId: string): Promise<RiskHistory> {
    const own = [...this.orders.values()].filter((order) => order.userId === userId);
    const delivered = own.filter((order) => order.status === ORDER_STATUS.DELIVERED);
    const cancelled = own.filter((order) => order.status === ORDER_STATUS.CANCELLED);
    const deliveredTotal = delivered.reduce((sum, order) => sum + order.pricing.totalMinor, 0);
    return Promise.resolve(toRiskHistory(delivered.length, cancelled.length, deliveredTotal));
  }

  /** Yalnizca test icin: kayitli siparis sayisi. */
  get size(): number {
    return this.orders.size;
  }
}

/** Mongo okumasiyla ayni bicim: iz yoksa `correlation` alani hic yoktur. */
function toPendingEvent(stored: StoredEvent): PendingEvent {
  return Object.keys(stored.correlation).length === 0
    ? stored.event
    : { ...stored.event, correlation: stored.correlation };
}
