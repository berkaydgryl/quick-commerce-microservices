/**
 * Ilerleyen rotalar deposu SOZLESME testi (T13.3): tick'in okudugu MOVING
 * rotalar ve kosullu yama. Ayni senaryolar bellekte (unit) ve gercek Mongo'da
 * (integration). Depo paylasilir: senaryolar yalnizca kendi siparislerine bakar.
 */

import { describe, expect, it } from 'vitest';

import type { Route } from '../../src/domain/route.js';
import { ROUTE_STATE } from '../../src/domain/route.js';
import type { MovingRouteRepository, RouteRepository } from '../../src/domain/route-repository.js';
import { planRoute } from '../../src/domain/route-planner.js';
import {
  courierId,
  DELIVERY,
  MARKET,
  MARKET_LOCATION,
  northOf,
  NOW_MS,
  orderId,
  ROUTE_RULE,
} from './couriers.js';

type Store = RouteRepository & MovingRouteRepository;

/** Okunan rotalardan yalnizca bu senaryonun siparisleri (depo paylasilir). */
const ALL = 10_000;

function movingRoute(order: string, courier: number, atMs: number): Route {
  return {
    orderId: order,
    courierId: courierId(courier),
    ...planRoute(
      { from: northOf(MARKET_LOCATION, 500), pickup: MARKET_LOCATION, dropoff: DELIVERY },
      ROUTE_RULE,
    ),
    createdAt: new Date(atMs),
    marketId: MARKET,
    state: ROUTE_STATE.MOVING,
  };
}

async function movingIds(store: Store, own: readonly string[]): Promise<string[]> {
  return (await store.listMoving(ALL))
    .map((route) => route.orderId)
    .filter((id) => own.includes(id));
}

export function describeMovingRouteStoreContract(name: string, getStore: () => Store): void {
  describe(`MovingRouteRepository sozlesmesi: ${name}`, () => {
    it('listMoving: yalnizca MOVING, uretilme anina gore eskiden yeniye', async () => {
      const store = getStore();
      const [later, earlier, done, ended] = [orderId(), orderId(), orderId(), orderId()];
      await store.insertOnce(movingRoute(later, 1, NOW_MS + 2_000));
      await store.insertOnce(movingRoute(earlier, 2, NOW_MS + 1_000));
      await store.insertOnce({ ...movingRoute(done, 3, NOW_MS), state: ROUTE_STATE.DONE });
      await store.insertOnce({ ...movingRoute(ended, 4, NOW_MS), state: ROUTE_STATE.ENDED });

      expect(await movingIds(store, [later, earlier, done, ended])).toEqual([earlier, later]);
    });

    it('durum alani olmayan (T13.3 oncesi) rota ILERLIYOR sayilir ve yamalanabilir (goc yok)', async () => {
      const store = getStore();
      const order = orderId();
      const { state: _state, ...legacy } = movingRoute(order, 1, NOW_MS);
      await store.insertOnce(legacy);

      expect(await movingIds(store, [order])).toEqual([order]);
      expect((await store.update(legacy, { state: ROUTE_STATE.ENDED }))?.state).toBe(
        ROUTE_STATE.ENDED,
      );
      expect(await movingIds(store, [order])).toEqual([]);
    });

    it('update: yama yazilir ve guncel rota doner; yamada olmayan alan yazilmaz', async () => {
      const store = getStore();
      const route = await store.insertOnce(movingRoute(orderId(), 1, NOW_MS));
      const pickedUpAt = new Date(NOW_MS + 90_000);

      const updated = await store.update(route, { pickedUpAt });

      expect(updated).toEqual({ ...route, pickedUpAt });
      expect(await store.findByOrder(route.orderId)).toEqual({ ...route, pickedUpAt });
      expect(Object.keys((await store.findByOrder(route.orderId)) ?? {})).not.toContain(
        'deliveredAt',
      );
    });

    it('update KOSULLU: rota yenilendiyse (yeniden atama) ya da MOVING degilse null, degisiklik yok', async () => {
      const store = getStore();
      const route = await store.insertOnce(movingRoute(orderId(), 1, NOW_MS));
      const replaced = movingRoute(route.orderId, 2, NOW_MS + 60_000);
      await store.replace(replaced);

      expect(await store.update(route, { pickupPublished: true })).toBeNull();
      expect(await store.findByOrder(route.orderId)).toEqual(replaced);

      const finished = await store.update(replaced, { state: ROUTE_STATE.DONE });
      expect(finished?.state).toBe(ROUTE_STATE.DONE);
      expect(await store.update(replaced, { endedAt: new Date(NOW_MS) })).toBeNull();
      expect(await movingIds(store, [route.orderId])).toEqual([]);
    });

    it('listMoving siniri: en fazla limit kadar rota', async () => {
      const store = getStore();
      await store.insertOnce(movingRoute(orderId(), 1, NOW_MS - 3_600_000));
      await store.insertOnce(movingRoute(orderId(), 2, NOW_MS - 3_500_000));

      expect(await store.listMoving(1)).toHaveLength(1);
    });
  });
}
