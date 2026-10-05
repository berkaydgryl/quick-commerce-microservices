/**
 * StartRoute use-case'i (T13.2, application/start-route.ts): rota yalnizca
 * siparisi su an tasiyan kuryeye ve yalnizca o kuryenin rotasiysa doner.
 * Tel uzerindeki davranis courier-grpc.spec.ts'te.
 */

import { ERROR_CODES, silentLogger } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { createStartRoute } from '../../src/application/start-route.js';
import { COURIER_STATUS } from '../../src/domain/courier.js';
import type { Route } from '../../src/domain/route.js';
import { planRoute } from '../../src/domain/route-planner.js';
import { InMemoryCourierStore } from '../../src/infrastructure/memory/in-memory-courier-store.js';
import { InMemoryRouteStore } from '../../src/infrastructure/memory/in-memory-route-store.js';
import {
  courier,
  courierId,
  DELIVERY,
  MARKET_LOCATION,
  NOW_MS,
  orderId,
  ROUTE_RULE,
} from '../support/couriers.js';

const routeOf = (order: string, courierNo: number): Route => ({
  orderId: order,
  courierId: courierId(courierNo),
  ...planRoute({ from: MARKET_LOCATION, pickup: MARKET_LOCATION, dropoff: DELIVERY }, ROUTE_RULE),
  createdAt: new Date(NOW_MS),
});

const carrying = (courierNo: number, order: string) =>
  courier(courierNo, { status: COURIER_STATUS.BUSY, currentOrderId: order });

async function setup(route: Route, couriers: Parameters<typeof carrying>[]) {
  const routes = new InMemoryRouteStore();
  await routes.insertOnce(route);
  const store = new InMemoryCourierStore(couriers.map(([no, order]) => carrying(no, order)));
  return createStartRoute(routes, store);
}

describe('createStartRoute', () => {
  it('siparisi tasiyan kuryenin rotasi: already_started, started_at = rotanin uretildigi an', async () => {
    const order = orderId();
    const route = routeOf(order, 1);
    const start = await setup(route, [[1, order]]);

    await expect(start({ orderId: order, courierId: courierId(1) }, silentLogger)).resolves.toEqual(
      {
        route,
        startedAt: new Date(NOW_MS),
        alreadyStarted: true,
      },
    );
  });

  it('bayat rota: siparisi kurye 2 tasiyor ama rota hala kurye 1 in (yeniden atama yarida) -> kurye 2 ye NOT_FOUND', async () => {
    const order = orderId();
    const start = await setup(routeOf(order, 1), [[2, order]]);

    await expect(
      start({ orderId: order, courierId: courierId(2) }, silentLogger),
    ).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
  });

  it('kurye siparisi birakti ya da baska siparis tasiyor -> NOT_FOUND (QA B1)', async () => {
    const order = orderId();
    const start = await setup(routeOf(order, 1), [[1, orderId()]]);

    await expect(
      start({ orderId: order, courierId: courierId(1) }, silentLogger),
    ).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      details: { orderId: order, courierId: courierId(1) },
    });
  });
});
