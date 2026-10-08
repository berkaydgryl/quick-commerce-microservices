/**
 * QA kara kutu (T13.2 PR 3, #124: rota ve ETA), gercek Mongo (Testcontainers) ve
 * gercek gRPC. Courier kopyalari uretimdeki acilis yoluyla kurulur
 * (openCourierStore: gocler, indeksler; kurye, market kopyasi ve routes Mongo'da).
 * Backend'in testleri use-case'i bellekte, Mongo deposunu sozlesmeyle ve iki
 * kopyayi sirayla sinar; burada:
 *
 *   Q1 Iki kopyaya ayni siparis icin 16 eszamanli AssignCourier: tek kurye,
 *      tek routes belgesi, butun cevaplarda ayni ETA; StartRoute iki kopyada
 *      birebir ayni; ETA istemcinin distance_meters'tan bulduguyla ayni (B4).
 *   Q2 Rota adiminda courier'in Mongo'su donar (vekil): AssignCourier
 *      SERVICE_UNAVAILABLE, kurye siparise bagli kalir, rota yazilmaz;
 *      cozulunce tekrar istek AYNI kuryeyi ve rotayi verir, tek belge.
 *   Q3 B1, Mongo'da: kopya A birakir, kopya B'nin StartRoute'u NOT_FOUND (rota
 *      gecmis olarak durur); kurye baska siparise gecince eski siparis
 *      NOT_FOUND, yenisi rotasini doner.
 *   Q4 B2, Mongo'da: birak + ayni kuryeye yeniden ata -> rota yenilenir
 *      (startedAt yeni atama ani), belge tek. #174: yolda birakilan kurye
 *      ROTADAKI ANLIK konumunda bosa cikar (birakma anindaki routeProgress;
 *      PM karari); yeni rota o noktadan baslar, ETA kisalir.
 *   #174'un kenarlari (alma sonrasi, rotasiz, baska atamanin rotasi, teslim
 *      gecmis, saat geride): qa-route-release.spec.ts.
 *   Q5 T13.2 PR 1 donemi verisi (atama var, rota yok): tekrar istek rota uretir
 *      (ETA > 0); market kopyada yoksa atama yine doner, ETA 0, WARN, rota yok.
 */

import { fixedClock, GRPC_STATUS } from '@getir/core';
import type { LogLine } from '@getir/core/testing';
import { courierV1 } from '@getir/proto';
import { appErrorOf } from '@getir/service-kit/testing';
import type { Document } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { startFreezingProxy } from '../../../../packages/mongo-kit/test/support/freezing-proxy.js';
import type { FreezingProxy } from '../../../../packages/mongo-kit/test/support/freezing-proxy.js';
import type { Route } from '../../src/domain/route.js';
import type { RouteRepository } from '../../src/domain/route-repository.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import {
  courier,
  DELIVERY,
  MARKET,
  MARKET_LOCATION,
  northOf,
  NOW_MS,
  orderId,
} from '../support/couriers.js';
import { outcomeOf } from '../support/qa-courier-harness.js';
import {
  clientEta,
  CURRENT_MOVEMENT,
  GEO_TOLERANCE_M,
  lastLocationOf,
  metersBetween,
  pointTowards,
  SPEED_MPS,
  useRouteWorld,
} from '../support/qa-route-world.js';

const MONGO_PORT = 27_017;
/** Donma testinde tur bu kadar bekler. */
const FROZEN_TIMEOUT_MS = 1_000;
const CONCURRENT_REQUESTS = 16;
const SECOND = 1_000;

const world = useRouteWorld();

function grpcCodeOf(result: {
  readonly error?: { readonly code: number } | undefined;
}): number | undefined {
  return result.error?.code;
}

describe('QA T13.2 PR 3 rota, gercek Mongo + gercek gRPC', () => {
  it('Q1 iki kopyaya ayni siparis icin 16 eszamanli AssignCourier: tek kurye, tek rota belgesi, ayni ETA; StartRoute iki kopyada birebir', async () => {
    const dbName = world.freshDb();
    const clock = fixedClock(NOW_MS);
    await world.seed(dbName, [
      courier(1, { lastLocation: northOf(MARKET_LOCATION, 600) }),
      courier(2, { lastLocation: northOf(MARKET_LOCATION, 900) }),
      courier(3, { lastLocation: northOf(MARKET_LOCATION, 1_200) }),
    ]);
    const a = await world.replica({ dbName, clock, name: 'courier-qa-rota-a' });
    const b = await world.replica({ dbName, clock, name: 'courier-qa-rota-b' });
    const order = orderId();

    const results = await Promise.all(
      Array.from({ length: CONCURRENT_REQUESTS }, (_, index) =>
        (index % 2 === 0 ? a : b).assign(order, MARKET, DELIVERY),
      ),
    );
    const outcomes = results.map(outcomeOf);
    const couriers = new Set(
      outcomes.map((outcome) => (outcome.kind === 'atandi' ? outcome.courierId : 'hata')),
    );
    const etas = new Set(results.map((result) => result.response?.etaSeconds));
    const [holder] = couriers;
    const fromA = await a.startRoute(order, holder ?? '');
    const fromB = await b.startRoute(order, holder ?? '');
    const route = fromA.response?.route;

    expect(couriers.size).toBe(1);
    expect(holder).not.toBe('hata');
    expect(etas.size).toBe(1);
    expect(await world.routeDocs(dbName, order)).toHaveLength(1);
    expect(fromA.error).toBeUndefined();
    expect(fromB.response).toEqual(fromA.response);
    expect(fromA.response?.alreadyStarted).toBe(true);
    expect(fromA.response?.startedAt).toEqual(new Date(NOW_MS));
    expect(route?.points.at(-1)).toEqual(DELIVERY);
    expect(
      route?.points.some(
        (point) => point.lat === MARKET_LOCATION.lat && point.lng === MARKET_LOCATION.lng,
      ),
    ).toBe(true);
    expect([...etas][0]).toBe(route?.etaSeconds);
    expect(route?.etaSeconds).toBe(clientEta(route?.distanceMeters ?? -1));
    expect(route?.etaSeconds).toBeGreaterThan(0);
  });

  it('Q2 rota adiminda courier in Mongo su donar: AssignCourier SERVICE_UNAVAILABLE, kurye bagli, rota yok; cozulunce ayni kurye ve rota, tek belge', async () => {
    const dbName = world.freshDb();
    const clock = fixedClock(NOW_MS);
    await world.seed(dbName, [courier(1, { lastLocation: northOf(MARKET_LOCATION, 700) })]);
    const proxy: FreezingProxy = await startFreezingProxy({
      host: world.container().getHost(),
      port: world.container().getMappedPort(MONGO_PORT),
    });
    world.onCleanup(() => proxy.close());
    world.onCleanup(() => proxy.thaw());
    let armed = false;
    // Kurye talep edildi (findAndModify bitti); siradaki Mongo islemi rotanin okunmasi: orada donar.
    const frozenOnRoute = (routes: RouteRepository): RouteRepository => ({
      findByOrder: (order) => {
        if (armed) {
          armed = false;
          proxy.freeze();
        }
        return routes.findByOrder(order);
      },
      insertOnce: (route: Route) => routes.insertOnce(route),
      replace: (route: Route) => routes.replace(route),
    });
    const frozen = await world.replica({
      dbName,
      clock,
      name: 'courier-qa-rota-donar',
      uri: `mongodb://127.0.0.1:${proxy.port}/?directConnection=true`,
      operationTimeoutMs: FROZEN_TIMEOUT_MS,
      wrapRoutes: frozenOnRoute,
    });
    const observer = await world.replica({ dbName, clock, name: 'courier-qa-rota-gozcu' });
    const order = orderId();

    armed = true;
    const lost = await frozen.assign(order, MARKET, DELIVERY);
    proxy.thaw();
    const bound = await observer.get(courier(1).id);
    const routesWhileLost = await world.routeDocs(dbName, order);
    let retried = await frozen.assign(order, MARKET, DELIVERY);
    for (let attempt = 0; attempt < 20 && retried.error !== undefined; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      retried = await frozen.assign(order, MARKET, DELIVERY);
    }
    const started = await observer.startRoute(order, courier(1).id);

    expect(grpcCodeOf(lost)).toBe(GRPC_STATUS.UNAVAILABLE);
    expect(appErrorOf(lost.error)?.code).toBe('SERVICE_UNAVAILABLE');
    expect(bound.response?.courier?.status).toBe(courierV1.CourierStatus.COURIER_STATUS_BUSY);
    expect(bound.response?.courier?.currentOrderId).toBe(order);
    expect(routesWhileLost).toHaveLength(0);
    expect(outcomeOf(retried)).toEqual({
      kind: 'atandi',
      courierId: courier(1).id,
      orderId: order,
    });
    expect(retried.response?.etaSeconds).toBeGreaterThan(0);
    expect(await world.routeDocs(dbName, order)).toHaveLength(1);
    expect(started.response?.route?.etaSeconds).toBe(retried.response?.etaSeconds);
  });

  it('Q3 B1 Mongo da: A birakir, B nin StartRoute u NOT_FOUND ve rota gecmis olarak durur; kurye baska siparise gecince eskisi NOT_FOUND, yenisi rotasini doner', async () => {
    const dbName = world.freshDb();
    const clock = fixedClock(NOW_MS);
    await world.seed(dbName, [courier(1, { lastLocation: northOf(MARKET_LOCATION, 500) })]);
    const a = await world.replica({ dbName, clock, name: 'courier-qa-b1-a' });
    const b = await world.replica({ dbName, clock, name: 'courier-qa-b1-b' });
    const first = orderId();
    const second = orderId();
    const holder = courier(1).id;

    expect(outcomeOf(await a.assign(first, MARKET, DELIVERY)).kind).toBe('atandi');
    expect((await a.release(first)).response?.released).toBe(true);
    const afterRelease = await b.startRoute(first, holder);
    const keptAsHistory = await world.routeDocs(dbName, first);
    clock.advance(5 * SECOND);
    expect(outcomeOf(await b.assign(second, MARKET, DELIVERY))).toEqual({
      kind: 'atandi',
      courierId: holder,
      orderId: second,
    });
    const oldOrder = await a.startRoute(first, holder);
    const newOrder = await a.startRoute(second, holder);

    expect(grpcCodeOf(afterRelease)).toBe(GRPC_STATUS.NOT_FOUND);
    expect(keptAsHistory).toHaveLength(1);
    expect(grpcCodeOf(oldOrder)).toBe(GRPC_STATUS.NOT_FOUND);
    expect(newOrder.error).toBeUndefined();
    expect(newOrder.response?.startedAt).toEqual(new Date(NOW_MS + 5 * SECOND));
  });

  it('Q4 B2 Mongo da: birak + ayni kuryeye ayni siparisi yeniden ata -> rota yenilenir (startedAt yeni atama ani), belge tek', async () => {
    const dbName = world.freshDb();
    const clock = fixedClock(NOW_MS);
    const start = northOf(MARKET_LOCATION, 800);
    await world.seed(dbName, [courier(1, { lastLocation: start })]);
    const a = await world.replica({ dbName, clock, name: 'courier-qa-b2-a' });
    const b = await world.replica({ dbName, clock, name: 'courier-qa-b2-b' });
    const order = orderId();
    const holder = courier(1).id;

    const assigned = await a.assign(order, MARKET, DELIVERY);
    const before = await b.startRoute(order, holder);
    // Zaman varsayimlari rotanin kendi kuralina (#197) dayanir.
    expect(await world.movementOf(dbName, order)).toEqual(CURRENT_MOVEMENT);
    clock.advance(5 * SECOND);
    // Birakma anindaki rota konumu (TO_MARKET: birinci bacakta 5 sn ilerlemis).
    const releasedAt = await world.routePositionAt(dbName, order, clock.now());
    const releaseMs = clock.now();
    expect((await b.release(order)).response?.released).toBe(true);
    const parked = await lastLocationOf(a, holder);
    clock.advance(5 * SECOND);
    const reassigned = await b.assign(order, MARKET, DELIVERY);
    const after = await a.startRoute(order, holder);
    const docs = await world.routeDocs(dbName, order);

    expect(outcomeOf(assigned).kind).toBe('atandi');
    expect(before.response?.startedAt).toEqual(new Date(NOW_MS));
    expect(outcomeOf(reassigned)).toEqual({ kind: 'atandi', courierId: holder, orderId: order });
    expect(after.response?.startedAt).toEqual(new Date(NOW_MS + 10 * SECOND));
    expect(docs).toHaveLength(1);
    expect(docs[0]?.['createdAt']).toEqual(new Date(NOW_MS + 10 * SECOND));
    // #174: kurye rotadaki ANLIK konumda bosa cikar (atama noktasinda degil); konumun ani birakma.
    expect(parked).toEqual({ location: releasedAt, at: new Date(releaseMs) });
    // Bagimsiz geometri (duz izdusum): baslangictan markete DOGRU 5 sn x hiz ilerlemis.
    const expected = pointTowards(start, MARKET_LOCATION, 5 * SPEED_MPS);
    expect(metersBetween(parked.location, expected)).toBeLessThan(GEO_TOLERANCE_M);
    // Yeni rota o noktadan baslar, marketten gecer, adres ayni; ETA mesafeden (B4) ve kisalir.
    const beforeRoute = before.response?.route;
    const afterRoute = after.response?.route;
    expect(afterRoute?.points[0]).toEqual(parked.location);
    expect(afterRoute?.points.at(-1)).toEqual(beforeRoute?.points.at(-1));
    expect(
      afterRoute?.points.some(
        (point) => point.lat === MARKET_LOCATION.lat && point.lng === MARKET_LOCATION.lng,
      ),
    ).toBe(true);
    expect(afterRoute?.etaSeconds).toBe(clientEta(afterRoute?.distanceMeters ?? -1));
    expect(afterRoute?.etaSeconds ?? 0).toBeLessThan(beforeRoute?.etaSeconds ?? 0);
  });

  it('Q5 T13.2 PR 1 donemi verisi (atama var, rota yok): tekrar istek rota uretir; market kopyada yoksa atama doner, ETA 0, tek WARN, rota yok', async () => {
    const dbName = world.freshDb();
    const clock = fixedClock(NOW_MS);
    await world.seed(dbName, [
      courier(1, { lastLocation: northOf(MARKET_LOCATION, 400) }),
      courier(2, { lastLocation: northOf(MARKET_LOCATION, 450) }),
    ]);
    const lines: LogLine[] = [];
    const service = await world.replica({ dbName, clock, name: 'courier-qa-eski-veri', lines });
    const withMarket = orderId();
    const withoutMarket = orderId();
    const firstHolder = outcomeOf(await service.assign(withMarket, MARKET, DELIVERY));
    const secondHolder = outcomeOf(await service.assign(withoutMarket, MARKET, DELIVERY));
    // Atamalar rota gelmeden once yapilmis gibi: rota belgeleri yok.
    await world.routesOf(dbName).deleteMany({});
    clock.advance(30 * SECOND);

    const again = await service.assign(withMarket, MARKET, DELIVERY);
    const regenerated = await world.routeDocs(dbName, withMarket);
    // Marketin kopyasi silinmis (veri hatasi): atama yine doner, rota uretilemez.
    await world
      .raw()
      .db(dbName)
      .collection<Document>(COLLECTIONS.MARKETS)
      .deleteOne({ _id: MARKET } as Document);
    const warnsBefore = lines.filter((line) => line.level === 'warn').length;
    const unknownMarket = await service.assign(withoutMarket, MARKET, DELIVERY);
    const warns = lines.filter((line) => line.level === 'warn').slice(warnsBefore);
    const noRoute = await service.startRoute(
      withoutMarket,
      secondHolder.kind === 'atandi' ? secondHolder.courierId : '',
    );

    expect(outcomeOf(again)).toEqual(firstHolder);
    expect(again.response?.etaSeconds).toBeGreaterThan(0);
    expect(regenerated).toHaveLength(1);
    expect(regenerated[0]?.['createdAt']).toEqual(new Date(NOW_MS + 30 * SECOND));
    expect(outcomeOf(unknownMarket)).toEqual(secondHolder);
    expect(unknownMarket.response?.etaSeconds).toBe(0);
    expect(warns.map((line) => line.message)).toEqual([
      'rota uretilemedi: market konumu bilinmiyor',
    ]);
    expect(await world.routeDocs(dbName, withoutMarket)).toHaveLength(0);
    expect(grpcCodeOf(noRoute)).toBe(GRPC_STATUS.NOT_FOUND);
  });
});
