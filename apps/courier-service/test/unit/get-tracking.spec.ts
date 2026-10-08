/**
 * Siparisin takibi (T13.3; GetTracking): yalnizca bu siparisin rotasindan,
 * gizlilik kuraliyla. Cikti @getir/contracts orderTrackingSchema'dan gecer
 * (gateway REST'e aynen tasir): rota boyunca HER ANDA kurallar tutar.
 */

import { fixedClock, silentLogger } from '@getir/core';
import { orderTrackingSchema } from '@getir/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import { createAdvanceRoute } from '../../src/application/advance-route.js';
import { COURIER_FALLBACK_NAME, createGetTracking } from '../../src/application/get-tracking.js';
import { COURIER_STATUS } from '../../src/domain/courier.js';
import { ROUTE_STATE } from '../../src/domain/route.js';
import type { Route } from '../../src/domain/route.js';
import { planRoute } from '../../src/domain/route-planner.js';
import type { MovementRule } from '../../src/domain/route-progress.js';
import { routeSchedule, TRACKING_PHASE } from '../../src/domain/route-progress.js';
import { InMemoryCourierStore } from '../../src/infrastructure/memory/in-memory-courier-store.js';
import { InMemoryLiveLocationStore } from '../../src/infrastructure/memory/in-memory-live-location.js';
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
import { RecordingRouteEvents } from '../support/recording-route-events.js';
import { toRest } from '../support/tracking-rest.js';

const RULE = { speedKmh: 36, prepSeconds: 30 };
/** Onceki musterinin kapisi: kurye buradan atandi (sizmamali). */
const PREVIOUS_DOOR = northOf(MARKET_LOCATION, 900);

let clock: ReturnType<typeof fixedClock>;
let couriers: InMemoryCourierStore;
let routes: InMemoryRouteStore;
let order: string;
let route: Route;

const trackingWith = (rule: MovementRule) =>
  createGetTracking({ routes, couriers, rule, clock })(order);
const tracking = () => trackingWith(RULE);

/**
 * Takibin okunacagi anlar (ms): saat geride (-30 sn) baslayip varistan sonraya
 * 7 sn adimla, arti routeProgress'in asama sinirlari (alma ve varis ani, +-1 ms;
 * sinirlar milisaniyeye yuvarlanir).
 */
function instants(rule: MovementRule): number[] {
  const schedule = routeSchedule(route, rule);
  const pickupMs = Math.round(schedule.pickupSeconds * 1_000);
  const arrivalMs = Math.max(pickupMs, Math.round(schedule.arrivalSeconds * 1_000));
  const sweep: number[] = [];
  for (let ms = -30_000; ms <= arrivalMs + 10_000; ms += 7_000) {
    sweep.push(ms);
  }
  return [...sweep, pickupMs - 1, pickupMs, pickupMs + 1, arrivalMs - 1, arrivalMs, arrivalMs + 1];
}

/**
 * Rota boyunca her anda cikti sozlesmeden (orderTrackingSchema +
 * enforceTrackingPhase) gecer; DELIVERED her zaman alma ve teslim anli. Gorulen
 * asamalari ilk gorulme sirasiyla doner.
 */
async function everyMoment(rule: MovementRule): Promise<string[]> {
  const phases = new Set<string>();
  for (const ms of instants(rule)) {
    clock.set(NOW_MS + ms);
    const result = await trackingWith(rule);
    phases.add(result.phase);
    const parsed = orderTrackingSchema.safeParse(toRest(order, result));
    expect(parsed.success, `${ms} ms: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    if (result.phase === TRACKING_PHASE.DELIVERED) {
      // Alma <= teslim (#190): karisik kaynakta ve hiz ayari degisince de.
      const pickedUpAt = result.pickedUpAt?.getTime() ?? Number.NaN;
      const deliveredAt = result.deliveredAt?.getTime() ?? Number.NaN;
      expect(pickedUpAt, `${ms} ms`).toBeLessThanOrEqual(deliveredAt);
    }
  }
  return [...phases];
}

/** Rotaya kilometre tasi yazar; kosullu guncelleme tutmazsa test durur. */
async function record(patch: Parameters<InMemoryRouteStore['update']>[1]): Promise<void> {
  const updated = await routes.update(route, patch);
  if (updated === null) {
    throw new Error('rota guncellenmedi');
  }
  route = updated;
}

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
  it('rota boyunca HER ANDA (asama sinirlari dahil) cikti sozlesmeden gecer (gizlilik ve tutarlilik)', async () => {
    expect(await everyMoment(RULE)).toEqual(['TO_MARKET', 'TO_CUSTOMER', 'DELIVERED']);
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

describe('teslim ani garantisi (#190): DELIVERED her zaman teslim ve alma anli', () => {
  // Kenar: teslim ANI kaydedildi (deliveredAt; tick ardindan DONE yazar) ama
  // zamandan hesap teslime ulasmadi (hiz ayari yavasladi, saat geride). Asama
  // ve anlar kayittan. Kayitsiz DELIVERED yalniz hesaptan gelir, o da anlariyla.
  // Asamayi belirleyen deliveredAt'tir, `state` DEGIL: teslim anisiz DONE
  // (yazicisi yok) asamayi hesaba birakir; son test bunu sabitler.
  const SLOW: MovementRule = { speedKmh: 6, prepSeconds: 600 };
  const FAST: MovementRule = { speedKmh: 120, prepSeconds: 0 };

  it('tick teslime geldigi TEK turda alma anini da yazar (alma <= teslim); hiz ayari sonra yavaslasa da kayitli anlarla DELIVERED', async () => {
    const tick = createAdvanceRoute({
      routes,
      couriers,
      events: new RecordingRouteEvents(),
      live: new InMemoryLiveLocationStore(),
      rule: RULE,
      clock,
    });
    clock.set(NOW_MS + Math.ceil(routeSchedule(route, RULE).arrivalSeconds * 1_000) + 5_000);
    await tick(route, await couriers.findById(route.courierId), silentLogger);
    const recorded = await routes.findByOrder(order);
    expect(recorded).toMatchObject({ state: ROUTE_STATE.DONE });
    const pickedUpAt = recorded?.pickedUpAt?.getTime() ?? Number.NaN;
    const deliveredAt = recorded?.deliveredAt?.getTime() ?? Number.NaN;
    expect(pickedUpAt).toBeLessThanOrEqual(deliveredAt);

    // Hesap SLOW kuraliyla hep teslimin gerisinde: asama ve anlar kayittan.
    expect(await everyMoment(SLOW)).toEqual([TRACKING_PHASE.DELIVERED]);
    clock.set(NOW_MS);
    expect(await trackingWith(SLOW)).toMatchObject({
      phase: TRACKING_PHASE.DELIVERED,
      pickedUpAt: recorded?.pickedUpAt,
      deliveredAt: recorded?.deliveredAt,
      location: DELIVERY,
      remainingMeters: 0,
      etaSeconds: 0,
    });
  });

  it.each([
    ['kayit yok', {}],
    ['alma kayitli', { pickedUpAt: new Date(NOW_MS + 40_000) }],
    // Eski (yavas) ayarla kaydedilmis gec alma: yeni ayarla hesaplanan teslim
    // ondan once duser; gosterilen teslim almadan once olmaz.
    ['alma kayitli (eski yavas ayarla, gec)', { pickedUpAt: new Date(NOW_MS + 600_000) }],
    [
      'teslim kayitli (DONE)',
      {
        pickedUpAt: new Date(NOW_MS + 40_000),
        deliveredAt: new Date(NOW_MS + 90_000),
        deliveryPublished: true,
        state: ROUTE_STATE.DONE,
      },
    ],
  ] as const)(
    '%s x hiz ayari (yavas, ayni, hizli) x her an: sozlesme tutar',
    async (_case, recorded) => {
      await record(recorded);

      for (const rule of [SLOW, RULE, FAST]) {
        await everyMoment(rule);
      }
    },
  );

  it('DONE ama teslim ani yok (yazicisi yok; savunma): DELIVERED kayittan GELMEZ, asama hesaptan; her an sozlesme', async () => {
    await record({ state: ROUTE_STATE.DONE });

    expect(await everyMoment(RULE)).toEqual(['TO_MARKET', 'TO_CUSTOMER', 'DELIVERED']);
  });
});
