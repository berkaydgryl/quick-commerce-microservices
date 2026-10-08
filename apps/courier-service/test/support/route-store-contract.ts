/**
 * routes deposu SOZLESME testi (T13.2): ayni senaryolar bellekte (unit) ve
 * gercek Mongo'da (integration). Her senaryo kendi siparis kimligiyle calisir.
 */

import { describe, expect, it } from 'vitest';

import type { Route } from '../../src/domain/route.js';
import { planRoute } from '../../src/domain/route-planner.js';
import type { RouteBatchReader, RouteRepository } from '../../src/domain/route-repository.js';
import {
  courierId,
  DELIVERY,
  MARKET_LOCATION,
  MOVEMENT_RULE,
  northOf,
  NOW_MS,
  orderId,
  ROUTE_RULE,
} from './couriers.js';

/** `meters` kuzeyden gelen kuryenin rotasi; ondalik konumlar (kayipsiz okunmali). */
function routeFor(order: string, courier: number, meters: number, atMs = NOW_MS): Route {
  return {
    orderId: order,
    courierId: courierId(courier),
    ...planRoute(
      { from: northOf(MARKET_LOCATION, meters), pickup: MARKET_LOCATION, dropoff: DELIVERY },
      ROUTE_RULE,
    ),
    createdAt: new Date(atMs),
  };
}

export function describeRouteStoreContract(
  name: string,
  getStore: () => RouteRepository & RouteBatchReader,
): void {
  describe(`RouteRepository sozlesmesi: ${name}`, () => {
    it('findByOrders (#205): bulunan siparislerin rotalari tek okumada; olmayan atlanir, bos liste bos', async () => {
      const store = getStore();
      const first = routeFor(orderId(), 1, 640);
      const second = routeFor(orderId(), 2, 300);
      await store.insertOnce(first);
      await store.insertOnce(second);

      const found = await store.findByOrders([second.orderId, orderId(), first.orderId]);

      expect([...found].sort((left, right) => (left.orderId < right.orderId ? -1 : 1))).toEqual(
        [first, second].sort((left, right) => (left.orderId < right.orderId ? -1 : 1)),
      );
      expect(await store.findByOrders([])).toEqual([]);
    });

    it('rota ALAN KAYBI olmadan yazilir ve okunur (noktalar ondalik kaybetmez); olmayan siparis null', async () => {
      const store = getStore();
      const route = routeFor(orderId(), 1, 640);

      expect(await store.insertOnce(route)).toEqual(route);
      expect(await store.findByOrder(route.orderId)).toEqual(route);
      expect(await store.findByOrder(orderId())).toBeNull();
    });

    it('hareket kurali (#197) insertOnce ve replace ile yazilir, aynen okunur', async () => {
      const store = getStore();
      const route = { ...routeFor(orderId(), 1, 640), movement: MOVEMENT_RULE };

      expect(await store.insertOnce(route)).toEqual(route);
      expect(await store.findByOrder(route.orderId)).toEqual(route);
      const renewed = {
        ...routeFor(route.orderId, 2, 300, NOW_MS + 60_000),
        movement: { speedKmh: 15, prepSeconds: 90 },
      };
      await store.replace(renewed);
      expect(await store.findByOrder(route.orderId)).toEqual(renewed);
    });

    it('insertOnce BIR KEZ yazar: ikinci rota (baska an, baska konum) yazilmaz, ilki doner', async () => {
      const store = getStore();
      const order = orderId();
      const first = routeFor(order, 1, 300);
      const second = routeFor(order, 1, 900, NOW_MS + 60_000);

      await store.insertOnce(first);
      const kept = await store.insertOnce(second);

      expect(kept).toEqual(first);
      expect(await store.findByOrder(order)).toEqual(first);
    });

    it('eszamanli on insertOnce: tek rota kalir, hepsi ayni rotayi gorur', async () => {
      const store = getStore();
      const order = orderId();
      const candidates = Array.from({ length: 10 }, (_, index) =>
        routeFor(order, 1, 100 * (index + 1), NOW_MS + index),
      );

      const results = await Promise.all(candidates.map((route) => store.insertOnce(route)));

      const stored = await store.findByOrder(order);
      expect(stored).not.toBeNull();
      expect(results.every((result) => JSON.stringify(result) === JSON.stringify(stored))).toBe(
        true,
      );
    });

    it('replace siparisin rotasini degistirir (yeniden atama); yoksa yazar', async () => {
      const store = getStore();
      const order = orderId();
      const old = routeFor(order, 1, 300);
      const renewed = routeFor(order, 2, 1_200, NOW_MS + 60_000);
      const fresh = routeFor(orderId(), 3, 500);

      await store.insertOnce(old);
      await store.replace(renewed);
      await store.replace(fresh);

      expect(await store.findByOrder(order)).toEqual(renewed);
      expect(await store.findByOrder(fresh.orderId)).toEqual(fresh);
    });
  });
}
