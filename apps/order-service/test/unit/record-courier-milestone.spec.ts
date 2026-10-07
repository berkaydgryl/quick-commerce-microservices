/**
 * RecordCourierMilestone use-case (T14.3): bellek deposunda yazim, olaylar,
 * surum cakismasinda yeniden karar ve sonuclar.
 */

import { ERROR_CODES, EVENTS, fixedClock, ID_PREFIX, newId, ORDER_STATUS } from '@getir/core';
import { describe, expect, it, vi } from 'vitest';

import { createRecordCourierMilestone } from '../../src/application/record-courier-milestone.js';
import type { RecordCourierMilestone } from '../../src/application/record-courier-milestone.js';
import { advanceOrder, COURIER_MILESTONE } from '../../src/domain/courier-milestone.js';
import { statusChangedEvents } from '../../src/domain/order-events.js';
import { orderVersionConflict } from '../../src/domain/order-repository.js';
import type { Order } from '../../src/domain/order.js';
import { transitionOrder } from '../../src/domain/order.js';
import { InMemoryOrderStore } from '../../src/infrastructure/memory/in-memory-order-store.js';
import { insertWithCourier, newCourierId } from '../support/courier-milestone-fixtures.js';
import { insertPaid } from '../support/order-builders.js';

const clock = fixedClock(Date.UTC(2026, 9, 7, 21, 0));
const MINUTE_MS = 60_000;
const WRITE_ATTEMPTS = 3;
const S = ORDER_STATUS;

function recordOn(repository: InMemoryOrderStore | ConflictingStore): RecordCourierMilestone {
  return createRecordCourierMilestone({ repository, clock, writeAttempts: WRITE_ATTEMPTS });
}

const pickedUp = (order: Order, courierId: string, occurredAt = clock.date()) => ({
  orderId: order.id,
  milestone: { kind: COURIER_MILESTONE.PICKED_UP, courierId, marketId: order.marketId },
  occurredAt,
});
const delivered = (order: Order, courierId: string, occurredAt = clock.date()) => ({
  orderId: order.id,
  milestone: { kind: COURIER_MILESTONE.DELIVERED, courierId },
  occurredAt,
});

/** Bu siparisin, yazilan olaylardan order.status_changed hedefleri. */
function statusEventsOf(store: InMemoryOrderStore, orderId: string): unknown[] {
  return store.recordedEvents
    .filter((event) => event.orderId === orderId && event.topic === EVENTS.ORDER_STATUS_CHANGED)
    .map((event) => event.payload['to']);
}

/** Ilk yazimdan once siparisi `concurrent` ile degistiren depo: es zamanli yazimi canlandirir. */
class ConflictingStore {
  private raced = false;

  constructor(
    readonly inner: InMemoryOrderStore,
    private readonly concurrent: (order: Order) => Order,
  ) {}

  findById(orderId: string): Promise<Order | null> {
    return this.inner.findById(orderId);
  }

  async update(
    order: Order,
    expectedVersion: number,
    events: Parameters<InMemoryOrderStore['update']>[2],
  ) {
    if (!this.raced) {
      this.raced = true;
      const current = await this.inner.findById(order.id);
      if (current !== null) {
        const next = this.concurrent(current);
        await this.inner.update(next, current.version, statusChangedEvents(current, next));
      }
    }
    return this.inner.update(order, expectedVersion, events);
  }
}

describe('RecordCourierMilestone (T14.3)', () => {
  it('paket alindi: PREPARING -> ON_THE_WAY, tek order.status_changed', async () => {
    const store = new InMemoryOrderStore();
    const courierId = newCourierId();
    const order = await insertWithCourier(store, clock, courierId);

    const result = await recordOn(store)(pickedUp(order, courierId));

    expect(result).toEqual({ outcome: 'advanced', from: S.PREPARING, to: S.ON_THE_WAY });
    expect((await store.findById(order.id))?.status).toBe(S.ON_THE_WAY);
    expect(statusEventsOf(store, order.id).slice(-1)).toEqual([S.ON_THE_WAY]);
  });

  it('teslim once geldi: PREPARING -> DELIVERED, iki gecis ve iki olay tek yazimda', async () => {
    const store = new InMemoryOrderStore();
    const courierId = newCourierId();
    const order = await insertWithCourier(store, clock, courierId);

    const result = await recordOn(store)(delivered(order, courierId));

    expect(result).toEqual({ outcome: 'advanced', from: S.PREPARING, to: S.DELIVERED });
    const saved = await store.findById(order.id);
    expect(saved?.status).toBe(S.DELIVERED);
    expect(saved?.version).toBe(order.version + 2);
    expect(statusEventsOf(store, order.id).slice(-2)).toEqual([S.ON_THE_WAY, S.DELIVERED]);
  });

  it('tekrar: ikinci ayni olay yazmaz', async () => {
    const store = new InMemoryOrderStore();
    const courierId = newCourierId();
    const order = await insertWithCourier(store, clock, courierId);
    const record = recordOn(store);

    await record(pickedUp(order, courierId));
    const again = await record(pickedUp(order, courierId));

    expect(again).toEqual({ outcome: 'duplicate', status: S.ON_THE_WAY });
    expect(statusEventsOf(store, order.id).filter((to) => to === S.ON_THE_WAY)).toHaveLength(1);
  });

  it('kurye henuz yazilmamis (PAID): not-yet, hicbir sey yazilmaz', async () => {
    const store = new InMemoryOrderStore();
    const paid = await insertPaid(store, clock);

    const result = await recordOn(store)(pickedUp(paid, newCourierId()));

    expect(result).toEqual({ outcome: 'not-yet', status: S.PAID });
    expect(await store.findById(paid.id)).toEqual(paid);
  });

  it('baska kurye: stale, yazilmaz; CANCELLED: ignored', async () => {
    const store = new InMemoryOrderStore();
    const order = await insertWithCourier(store, clock, newCourierId());
    const paid = await insertPaid(store, clock);
    const cancelled = transitionOrder(paid, S.CANCELLED, clock);
    await store.update(cancelled, paid.version, []);
    const record = recordOn(store);

    await expect(record(delivered(order, newCourierId()))).resolves.toEqual({
      outcome: 'stale',
      status: S.PREPARING,
      field: 'courier',
    });
    await expect(record(delivered(cancelled, newCourierId()))).resolves.toEqual({
      outcome: 'ignored',
      status: S.CANCELLED,
    });
    expect((await store.findById(order.id))?.status).toBe(S.PREPARING);
  });

  it('siparis yok: unknown-order', async () => {
    const result = await recordOn(new InMemoryOrderStore())({
      orderId: newId(ID_PREFIX.ORDER),
      milestone: { kind: COURIER_MILESTONE.DELIVERED, courierId: newCourierId() },
      occurredAt: clock.date(),
    });

    expect(result).toEqual({ outcome: 'unknown-order' });
  });

  it('surum cakismasi: siparis yeniden okunur, karar guncel halden (es zamanli tekrar -> duplicate)', async () => {
    const inner = new InMemoryOrderStore();
    const courierId = newCourierId();
    const order = await insertWithCourier(inner, clock, courierId);
    // Ayni olayin ikinci teslimi araya girip ON_THE_WAY yazar.
    const store = new ConflictingStore(inner, (current) =>
      advanceOrder(current, [S.ON_THE_WAY], clock.date()),
    );

    const result = await recordOn(store)(pickedUp(order, courierId));

    expect(result).toEqual({ outcome: 'duplicate', status: S.ON_THE_WAY });
    expect(statusEventsOf(inner, order.id).filter((to) => to === S.ON_THE_WAY)).toHaveLength(1);
  });

  it('surum cakismasi: araya picked_up girdiyse delivered guncel halden tek gecis yazar', async () => {
    const inner = new InMemoryOrderStore();
    const courierId = newCourierId();
    const order = await insertWithCourier(inner, clock, courierId);
    const store = new ConflictingStore(inner, (current) =>
      advanceOrder(current, [S.ON_THE_WAY], clock.date()),
    );

    const result = await recordOn(store)(delivered(order, courierId));

    expect(result).toEqual({ outcome: 'advanced', from: S.ON_THE_WAY, to: S.DELIVERED });
    expect(statusEventsOf(inner, order.id).slice(-2)).toEqual([S.ON_THE_WAY, S.DELIVERED]);
  });

  it('gecisin ani olayin ani: yeniden teslimde gec islenen teslim kendi aniyla yazilir', async () => {
    const store = new InMemoryOrderStore();
    const courierId = newCourierId();
    const assignedAt = clock.now();
    const order = await insertWithCourier(store, clock, courierId);
    const later = fixedClock(assignedAt + 10 * MINUTE_MS);
    const deliveredAt = new Date(assignedAt + 4 * MINUTE_MS);

    await createRecordCourierMilestone({ repository: store, clock: later, writeAttempts: 3 })(
      delivered(order, courierId, deliveredAt),
    );

    const timeline = (await store.findById(order.id))?.timeline ?? [];
    expect(timeline.slice(-2)).toEqual([
      { status: S.ON_THE_WAY, at: deliveredAt },
      { status: S.DELIVERED, at: deliveredAt },
    ]);
  });

  it('cakisma surerse hak bitince CONFLICT firlatir (olay yeniden teslim edilir)', async () => {
    const store = new InMemoryOrderStore();
    const courierId = newCourierId();
    const order = await insertWithCourier(store, clock, courierId);
    const update = vi
      .spyOn(store, 'update')
      .mockRejectedValue(orderVersionConflict(order.id, order.version));

    await expect(recordOn(store)(pickedUp(order, courierId))).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
    });
    expect(update).toHaveBeenCalledTimes(WRITE_ATTEMPTS);
  });
});
