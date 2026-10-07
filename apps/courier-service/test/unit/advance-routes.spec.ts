/**
 * Tick turu (T13.3): rotalarin kuryeleri turun basinda TEK okumayla alinir (N+1
 * yok); devam sorusu false olunca tur kesilir ve kalanlar ertelenir; bir
 * rotanin hatasi turu durdurmaz.
 */

import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { describe, expect, it, vi } from 'vitest';

import type { AdvanceRoute } from '../../src/application/advance-route.js';
import { ADVANCE_OUTCOME } from '../../src/application/advance-route.js';
import { createAdvanceRoutes } from '../../src/application/advance-routes.js';
import { COURIER_STATUS } from '../../src/domain/courier.js';
import type { Route } from '../../src/domain/route.js';
import { InMemoryCourierStore } from '../../src/infrastructure/memory/in-memory-courier-store.js';
import { InMemoryRouteStore } from '../../src/infrastructure/memory/in-memory-route-store.js';
import { courier, courierId, DELIVERY, NOW_MS, orderId } from '../support/couriers.js';

async function setup(count: number) {
  const routes = new InMemoryRouteStore();
  const list: Route[] = [];
  for (let index = 0; index < count; index += 1) {
    list.push(
      await routes.insertOnce({
        orderId: orderId(),
        courierId: courierId(index + 1),
        points: [DELIVERY],
        pickupIndex: 0,
        distanceMeters: 0,
        etaSeconds: 0,
        createdAt: new Date(NOW_MS + index),
      }),
    );
  }
  const couriers = new InMemoryCourierStore(
    list.map((route, index) =>
      courier(index + 1, { status: COURIER_STATUS.BUSY, currentOrderId: route.orderId }),
    ),
  );
  return { routes, couriers, list };
}

describe('createAdvanceRoutes', () => {
  it('kuryeler TEK toplu okumayla; her rota kendi kuryesiyle ilerler', async () => {
    const { routes, couriers, list } = await setup(5);
    const findByIds = vi.spyOn(couriers, 'findByIds');
    const findById = vi.spyOn(couriers, 'findById');
    const advance = vi.fn<AdvanceRoute>(() => Promise.resolve(ADVANCE_OUTCOME.MOVING));

    const summary = await createAdvanceRoutes({ routes, couriers, advance, batchSize: 10 })(
      recordingLogger([]),
    );

    expect(summary.moving).toBe(5);
    expect(findByIds).toHaveBeenCalledTimes(1);
    expect(findById).not.toHaveBeenCalled();
    for (const [index, route] of list.entries()) {
      expect(advance.mock.calls[index]?.[0].orderId).toBe(route.orderId);
      expect(advance.mock.calls[index]?.[1]?.id).toBe(route.courierId);
    }
  });

  it('devam sorusu false olunca tur kesilir: kalanlar ertelenir (deferred)', async () => {
    const { routes, couriers } = await setup(5);
    const advance = vi.fn<AdvanceRoute>(() => Promise.resolve(ADVANCE_OUTCOME.MOVING));
    let allowed = 2;

    const summary = await createAdvanceRoutes({ routes, couriers, advance, batchSize: 10 })(
      recordingLogger([]),
      () => {
        allowed -= 1;
        return allowed >= 0;
      },
    );

    expect(advance).toHaveBeenCalledTimes(2);
    expect(summary).toMatchObject({ moving: 2, deferred: 3, failed: 0 });
  });

  it('bir rotanin hatasi turu durdurmaz: WARN ve failed; kurye kaydi yoksa null verilir', async () => {
    const { routes, list } = await setup(3);
    const lines: LogLine[] = [];
    const advance = vi
      .fn<AdvanceRoute>()
      .mockRejectedValueOnce(new Error('mongo zaman asimi'))
      .mockResolvedValue(ADVANCE_OUTCOME.ENDED);

    const summary = await createAdvanceRoutes({
      routes,
      couriers: new InMemoryCourierStore(),
      advance,
      batchSize: 10,
    })(recordingLogger(lines));

    expect(summary).toMatchObject({ failed: 1, ended: 2 });
    expect(advance.mock.calls.map((call) => call[1])).toEqual([null, null, null]);
    expect(lines.map((line) => line.level)).toEqual(['warn']);
    expect(lines[0]?.fields['orderId']).toBe(list[0]?.orderId);
  });

  it('bos turda kurye okunmaz', async () => {
    const couriers = new InMemoryCourierStore();
    const findByIds = vi.spyOn(couriers, 'findByIds');

    await createAdvanceRoutes({
      routes: new InMemoryRouteStore(),
      couriers,
      advance: vi.fn<AdvanceRoute>(),
      batchSize: 10,
    })(recordingLogger([]));

    expect(findByIds).not.toHaveBeenCalled();
  });
});
