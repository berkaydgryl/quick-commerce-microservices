/**
 * Siparisin takibi (T13.3; GetTracking): yalnizca bu siparisin rotasindan,
 * gizlilik kuraliyla. Cikti @getir/contracts orderTrackingSchema'dan gecer
 * (gateway REST'e aynen tasir): rota boyunca HER ANDA kurallar tutar.
 */

import { fixedClock } from '@getir/core';
import { orderTrackingSchema } from '@getir/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import type { OrderTracking } from '../../src/application/get-tracking.js';
import { COURIER_FALLBACK_NAME, createGetTracking } from '../../src/application/get-tracking.js';
import { COURIER_STATUS } from '../../src/domain/courier.js';
import { ROUTE_STATE } from '../../src/domain/route.js';
import type { Route } from '../../src/domain/route.js';
import { planRoute } from '../../src/domain/route-planner.js';
import { routeSchedule, TRACKING_PHASE } from '../../src/domain/route-progress.js';
import { InMemoryCourierStore } from '../../src/infrastructure/memory/in-memory-courier-store.js';
import { InMemoryRouteStore } from '../../src/infrastructure/memory/in-memory-route-store.js';
import {
  courier,
  courierId,
  DELIVERY,
  MARKET,
  MARKET_LOCATION,
  northOf,
  NOW_MS,
  orderId,
  ROUTE_RULE,
} from '../support/couriers.js';

const RULE = { speedKmh: 36, prepSeconds: 30 };
/** Onceki musterinin kapisi: kurye buradan atandi (sizmamali). */
const PREVIOUS_DOOR = northOf(MARKET_LOCATION, 900);

const ORDER_STATUS_OF = {
  [TRACKING_PHASE.TO_MARKET]: 'PREPARING',
  [TRACKING_PHASE.TO_CUSTOMER]: 'ON_THE_WAY',
  [TRACKING_PHASE.DELIVERED]: 'DELIVERED',
} as const;

/** Gateway'in yapacagi REST cevirisi (alan adlari sozlesmede ayni). */
function toRest(order: string, tracking: OrderTracking): unknown {
  return {
    orderId: order,
    status: ORDER_STATUS_OF[tracking.phase],
    phase: tracking.phase,
    courier: { id: tracking.courierId, name: tracking.courierName },
    ...(tracking.location === undefined ? {} : { location: tracking.location }),
    at: tracking.at.toISOString(),
    remainingMeters: tracking.remainingMeters,
    etaSeconds: tracking.etaSeconds,
    route: tracking.route,
    marketLocation: tracking.marketLocation,
    deliveryLocation: tracking.deliveryLocation,
    ...(tracking.pickedUpAt === undefined ? {} : { pickedUpAt: tracking.pickedUpAt.toISOString() }),
    ...(tracking.deliveredAt === undefined
      ? {}
      : { deliveredAt: tracking.deliveredAt.toISOString() }),
  };
}

let clock: ReturnType<typeof fixedClock>;
let couriers: InMemoryCourierStore;
let routes: InMemoryRouteStore;
let order: string;
let route: Route;

const tracking = () => createGetTracking({ routes, couriers, rule: RULE, clock })(order);

beforeEach(async () => {
  clock = fixedClock(NOW_MS);
  order = orderId();
  couriers = new InMemoryCourierStore([
    courier(1, { status: COURIER_STATUS.BUSY, currentOrderId: order, lastLocation: PREVIOUS_DOOR }),
  ]);
  routes = new InMemoryRouteStore();
  route = await routes.insertOnce({
    orderId: order,
    courierId: courierId(1),
    ...planRoute({ from: PREVIOUS_DOOR, pickup: MARKET_LOCATION, dropoff: DELIVERY }, ROUTE_RULE),
    createdAt: new Date(NOW_MS),
    marketId: MARKET,
    state: ROUTE_STATE.MOVING,
  });
});

describe('createGetTracking', () => {
  it('rota boyunca HER ANDA cikti sozlesmeden gecer (gizlilik ve tutarlilik)', async () => {
    const end = Math.ceil(routeSchedule(route, RULE).arrivalSeconds) + 10;
    const phases = new Set<string>();
    for (let second = 0; second <= end; second += 5) {
      clock.set(NOW_MS + second * 1_000);
      const result = await tracking();
      phases.add(result.phase);

      const parsed = orderTrackingSchema.safeParse(toRest(order, result));
      expect(parsed.success, `${second}. sn: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
    expect([...phases]).toEqual(['TO_MARKET', 'TO_CUSTOMER', 'DELIVERED']);
  });

  it('GIZLILIK: paket alinmadan konum yok, rota market -> adres, kalan yalniz 2. bacak; onceki kapi hicbir alanda yok', async () => {
    clock.advance(20_000);
    const result = await tracking();

    expect(result.phase).toBe(TRACKING_PHASE.TO_MARKET);
    expect(result.location).toBeUndefined();
    expect(result.route[0]).toEqual(MARKET_LOCATION);
    expect(result.route.at(-1)).toEqual(DELIVERY);
    expect(result.remainingMeters).toBe(Math.round(routeSchedule(route, RULE).legTwoMeters));
    expect(result.etaSeconds % 60).toBe(0);
    expect(JSON.stringify(result)).not.toContain(String(PREVIOUS_DOOR.lat));
  });

  it('yolda konum ve saniye hassasiyetinde tahmin; teslimde konum adres, kalanlar 0', async () => {
    const schedule = routeSchedule(route, RULE);
    clock.set(NOW_MS + Math.ceil(schedule.pickupSeconds * 1_000) + 10_000);
    const onTheWay = await tracking();
    expect(onTheWay.phase).toBe(TRACKING_PHASE.TO_CUSTOMER);
    expect(onTheWay.location).toBeDefined();
    expect(onTheWay.pickedUpAt).toBeDefined();

    clock.set(NOW_MS + Math.ceil(schedule.arrivalSeconds * 1_000) + 1_000);
    const delivered = await tracking();
    expect(delivered).toMatchObject({
      phase: TRACKING_PHASE.DELIVERED,
      location: DELIVERY,
      remainingMeters: 0,
      etaSeconds: 0,
    });
  });

  it('kaydedilmis kilometre tasi asamayi GERI GOTURMEZ (hiz ayari degisse de)', async () => {
    const pickedUpAt = new Date(NOW_MS + 5_000);
    await routes.update(route, { pickedUpAt });
    clock.advance(6_000); // hesap henuz TO_MARKET

    const result = await tracking();

    expect(result.phase).toBe(TRACKING_PHASE.TO_CUSTOMER);
    expect(result.pickedUpAt).toEqual(pickedUpAt);
    expect(result.location).toEqual(MARKET_LOCATION);
    // Hesap geride: tahmin ilk bacagin suresini tasir, o yuzden dakikaya yuvarli.
    expect(result.etaSeconds % 60).toBe(0);
  });

  it('NOT_FOUND: rota yok, rota ENDED, teslimattan once kurye birakildi', async () => {
    await expect(
      createGetTracking({ routes, couriers, rule: RULE, clock })(orderId()),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    await couriers.releaseByOrder(order, new Date(NOW_MS + 1_000));
    await expect(tracking()).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await routes.update(route, { state: ROUTE_STATE.ENDED, endedAt: new Date(NOW_MS + 2_000) });
    await expect(tracking()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('yeniden atama penceresi: rota ENDED iken kurye siparisi yeniden aldi (yeni rota henuz yok) -> eski rota gosterilmez', async () => {
    await routes.update(route, { state: ROUTE_STATE.ENDED, endedAt: new Date(NOW_MS + 1_000) });
    clock.advance(5_000);

    await expect(tracking()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('teslim edilmis siparisin takibi kurye bosa ciktiktan sonra da okunur; kurye kaydi yoksa yedek ad', async () => {
    const deliveredAt = new Date(NOW_MS + 600_000);
    await routes.update(route, {
      pickedUpAt: new Date(NOW_MS + 100_000),
      deliveredAt,
      deliveryPublished: true,
      state: ROUTE_STATE.DONE,
    });
    await couriers.releaseByOrder(order, deliveredAt, { location: DELIVERY });
    clock.advance(900_000);

    expect((await tracking()).phase).toBe(TRACKING_PHASE.DELIVERED);

    const empty = new InMemoryCourierStore();
    const result = await createGetTracking({ routes, couriers: empty, rule: RULE, clock })(order);
    expect(result.courierName).toBe(COURIER_FALLBACK_NAME);
  });

  describe('teslim ani yarisi (QA N1): rota ile kurye okumasi arasina olay duser', () => {
    /** Kurye okunurken once araya giren olayi isletir; rota okumalarini sayar. */
    function racing(between: () => Promise<void>) {
      const reads = { route: 0 };
      const tracker = createGetTracking({
        routes: {
          findByOrder: (id) => {
            reads.route += 1;
            return routes.findByOrder(id);
          },
        },
        couriers: {
          findById: async (id) => {
            await between();
            return couriers.findById(id);
          },
        },
        rule: RULE,
        clock,
      });
      return { tracker, reads };
    }
    const deliveredAt = new Date(NOW_MS + 600_000);
    /** Tick'in sirasi: once teslim ani, SONRA kurye adreste birakilir. */
    const deliver = async () => {
      await routes.update(route, { pickedUpAt: new Date(NOW_MS + 100_000), deliveredAt });
      await couriers.releaseByOrder(order, deliveredAt, {
        courierId: courierId(1),
        location: DELIVERY,
      });
    };
    /** ReleaseCourier'in sirasi: kurye birakilir, SONRA rota ENDED. */
    const cancel = async (at: Date) => {
      await couriers.releaseByOrder(order, at);
      const current = await routes.findByOrder(order);
      if (current !== null) await routes.update(current, { state: ROUTE_STATE.ENDED, endedAt: at });
    };

    it('teslim araya duserse NOT_FOUND degil DELIVERED; rota BIR KEZ yeniden okunur', async () => {
      clock.set(deliveredAt.getTime() - 1);
      const { tracker, reads } = racing(deliver);

      const result = await tracker(order);

      expect(result.phase).toBe(TRACKING_PHASE.DELIVERED);
      expect(result.deliveredAt).toEqual(deliveredAt);
      expect(reads.route).toBe(2);
    });

    it('araya iptal duserse (kurye birakildi, rota ENDED) NOT_FOUND', async () => {
      const { tracker } = racing(() => cancel(new Date(NOW_MS + 1_000)));

      await expect(tracker(order)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('iptal ile teslim ust uste duserse (rota ENDED + teslim ani) NOT_FOUND: birakilan rota gosterilmez', async () => {
      const { tracker } = racing(async () => {
        await deliver();
        const current = await routes.findByOrder(order);
        if (current !== null) {
          await routes.replace({ ...current, state: ROUTE_STATE.ENDED, endedAt: deliveredAt });
        }
      });

      await expect(tracker(order)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('araya AYNI kuryeye yeniden atama duserse (yeni rota ani) NOT_FOUND: eski ve yeni rota karismaz', async () => {
      const { tracker } = racing(async () => {
        await couriers.releaseByOrder(order, new Date(NOW_MS + 1_000));
        await routes.replace({ ...route, createdAt: new Date(NOW_MS + 2_000), deliveredAt });
      });

      await expect(tracker(order)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  it('kurye siparisi YENIDEN aldiysa (atama rotadan yeni) eski rota gosterilmez: NOT_FOUND', async () => {
    couriers = new InMemoryCourierStore([
      courier(1, {
        status: COURIER_STATUS.BUSY,
        currentOrderId: order,
        lastAssignedAt: new Date(NOW_MS + 60_000),
      }),
    ]);
    clock.set(NOW_MS + 61_000);

    await expect(tracking()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
