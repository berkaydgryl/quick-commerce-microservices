/**
 * Uctan uca kapi testi: gercek gRPC sunucusu + gercek istemci, bellek deposu.
 * Sozlesme: dogrulama (INVALID_ARGUMENT), NOT_FOUND, tekrar guvenligi,
 * kullanimdan kalkan dark_store_id; atamanin varis tahmini ve StartRoute'un
 * ayni rotayi donmesi (T13.2).
 */

import { ERROR_CODES, fixedClock, GRPC_STATUS } from '@getir/core';
import { courierV1 } from '@getir/proto';
import { appErrorOf, startTestGrpcServer } from '@getir/service-kit/testing';
import type { TestGrpcServer, UnaryCall } from '@getir/service-kit/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildCourierService } from '../../src/bootstrap.js';
import { COURIER_STATUS } from '../../src/domain/courier.js';
import { planRoute } from '../../src/domain/route-planner.js';
import { InMemoryCourierStore } from '../../src/infrastructure/memory/in-memory-courier-store.js';
import {
  courier,
  courierId,
  DELIVERY,
  FAR_MARKET,
  FAR_MARKET_LOCATION,
  MARKET,
  MARKET_LOCATION,
  northOf,
  NOW_MS,
  orderId,
  ROUTE_RULE,
  SEEDED_AT,
  TEST_MARKETS,
} from '../support/couriers.js';

/** Kurye 1 marketin tam yerinde: rota market -> adres (ilk bacak 0 parca). */
const MARKET_ROUTE = planRoute(
  { from: MARKET_LOCATION, pickup: MARKET_LOCATION, dropoff: DELIVERY },
  ROUTE_RULE,
);

/** Hic bos kuryesi olmayan bolge: yalnizca OFFLINE kurye 4 orada. */
const EMPTY_MARKET = 'mkt_test-bos-bolge';
const EMPTY_LOCATION = { lat: 39.92, lng: 32.85 };

let server: TestGrpcServer | undefined;

const call: UnaryCall = (method, request, metadata) =>
  server === undefined
    ? Promise.reject(new Error('test sunucusu henuz baslamadi'))
    : server.call(method, request, metadata);

const errorCodeOf = (error: unknown): string | undefined => appErrorOf(error)?.code;

const service = courierV1.CourierServiceService;

const assignRequest = (fields: Partial<courierV1.AssignCourierRequest> = {}) =>
  courierV1.AssignCourierRequest.fromPartial({
    orderId: orderId(),
    marketId: MARKET,
    deliveryLocation: DELIVERY,
    ...fields,
  });

beforeAll(async () => {
  server = await startTestGrpcServer({
    serviceName: 'courier-test',
    services: [
      buildCourierService({
        couriers: new InMemoryCourierStore([
          courier(1),
          courier(2),
          courier(3, { lastLocation: FAR_MARKET_LOCATION }),
          courier(4, { lastLocation: EMPTY_LOCATION, status: COURIER_STATUS.OFFLINE }),
        ]),
        markets: new InMemoryCourierStore(
          [],
          [...TEST_MARKETS, { marketId: EMPTY_MARKET, location: EMPTY_LOCATION }],
        ),
        clock: fixedClock(NOW_MS),
      }),
    ],
  });
});

afterAll(async () => {
  await server?.stop();
});

describe('CourierService/AssignCourier', () => {
  it('marketin cevresindeki kuryeyi atar: BUSY, siparise bagli; dark_store_id ve market_id bos (havuz), ETA rotadan', async () => {
    const request = assignRequest();

    const { error, response } = await call(service.assignCourier, request);

    expect(error).toBeUndefined();
    expect(response).toEqual({
      courier: {
        id: courierId(1),
        name: 'Kurye 1',
        darkStoreId: '',
        marketId: '',
        status: courierV1.CourierStatus.COURIER_STATUS_BUSY,
        currentOrderId: request.orderId,
        lastLocation: MARKET_LOCATION,
        lastLocationAt: SEEDED_AT,
      },
      etaSeconds: MARKET_ROUTE.etaSeconds,
    });
    expect(MARKET_ROUTE.etaSeconds).toBeGreaterThan(0);
  });

  it('ayni siparisin tekrari ayni kuryeyi doner; baska semtin marketi kendi cevresinden alir; dark_store_id okunmaz', async () => {
    const request = assignRequest({ marketId: FAR_MARKET, darkStoreId: 'ds_eski' });

    const first = await call(service.assignCourier, request);
    const second = await call(service.assignCourier, request);

    expect(first.response?.courier?.id).toBe(courierId(3));
    expect(second.response).toEqual(first.response);
  });

  it('marketin cevresinde bos kurye yoksa (yalnizca OFFLINE) NOT_FOUND', async () => {
    const { error } = await call(service.assignCourier, assignRequest({ marketId: EMPTY_MARKET }));

    expect(error?.code).toBe(GRPC_STATUS.NOT_FOUND);
    expect(errorCodeOf(error)).toBe(ERROR_CODES.NOT_FOUND);
  });

  it.each([
    ['siparis kimligi bicimsiz', { orderId: 'ord_1' }],
    ['siparis yerine kullanici kimligi', { orderId: `usr_${'a'.repeat(32)}` }],
    ['market yok (yalnizca eski dark_store_id)', { marketId: '', darkStoreId: 'ds_1' }],
    ['teslimat konumu yok', { deliveryLocation: undefined }],
    ['enlem disi', { deliveryLocation: { lat: 120, lng: 29 } }],
  ])('%s: INVALID_ARGUMENT + VALIDATION_FAILED', async (_name, fields) => {
    const { error } = await call(service.assignCourier, assignRequest(fields));

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(errorCodeOf(error)).toBe(ERROR_CODES.VALIDATION_FAILED);
  });
});

describe('CourierService/GetCourier', () => {
  it('kuryeyi doner; yoksa NOT_FOUND; bicimsiz kimlik INVALID_ARGUMENT', async () => {
    const found = await call(service.getCourier, { courierId: courierId(2) });
    const missing = await call(service.getCourier, { courierId: courierId(99) });
    const invalid = await call(service.getCourier, { courierId: 'crr_1' });

    expect(found.response?.courier?.id).toBe(courierId(2));
    expect(missing.error?.code).toBe(GRPC_STATUS.NOT_FOUND);
    expect(invalid.error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
  });
});

describe('CourierService/ReleaseCourier', () => {
  it('kuryeyi birakir; tekrar cagri released=false; birakilan kurye yeniden atanabilir', async () => {
    const request = assignRequest();
    const assigned = await call(service.assignCourier, request);
    const id = assigned.response?.courier?.id;

    const first = await call(service.releaseCourier, { orderId: request.orderId });
    const second = await call(service.releaseCourier, { orderId: request.orderId });
    const after = await call(service.getCourier, { courierId: id ?? '' });

    expect(first.response).toEqual({ released: true, courierId: id });
    expect(second.response).toEqual({ released: false, courierId: '' });
    expect(after.response?.courier?.status).toBe(courierV1.CourierStatus.COURIER_STATUS_IDLE);
    expect(after.response?.courier?.currentOrderId).toBe('');
  });

  it('bicimsiz siparis kimligi INVALID_ARGUMENT', async () => {
    const { error } = await call(service.releaseCourier, { orderId: '' });

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
  });
});

describe('CourierService/StartRoute', () => {
  /** Kendi sunucusu: kurye marketten 500 m kuzeyde, rota iki bacakli. */
  const away = northOf(MARKET_LOCATION, 500);
  let routeServer: TestGrpcServer | undefined;
  const routeCall: UnaryCall = (method, request, metadata) =>
    routeServer === undefined
      ? Promise.reject(new Error('rota sunucusu henuz baslamadi'))
      : routeServer.call(method, request, metadata);

  beforeAll(async () => {
    routeServer = await startTestGrpcServer({
      serviceName: 'courier-rota-test',
      services: [
        buildCourierService({
          couriers: new InMemoryCourierStore([
            courier(11, { lastLocation: away }),
            courier(12, { lastLocation: away }),
          ]),
          markets: new InMemoryCourierStore([], TEST_MARKETS),
          clock: fixedClock(NOW_MS),
        }),
      ],
    });
  });

  afterAll(async () => {
    await routeServer?.stop();
  });

  it('atamanin rotasini doner (kurye -> market -> adres), already_started; tekrar cagri ayni cevap', async () => {
    const request = assignRequest();
    const assigned = await routeCall(service.assignCourier, request);
    const holder = assigned.response?.courier?.id ?? '';

    const first = await routeCall(service.startRoute, {
      orderId: request.orderId,
      courierId: holder,
    });
    const second = await routeCall(service.startRoute, {
      orderId: request.orderId,
      courierId: holder,
    });

    const expected = planRoute(
      { from: away, pickup: MARKET_LOCATION, dropoff: DELIVERY },
      ROUTE_RULE,
    );
    expect(holder).toBe(courierId(11));
    expect(first.error).toBeUndefined();
    expect(first.response).toEqual({
      route: {
        points: expected.points,
        distanceMeters: expected.distanceMeters,
        etaSeconds: assigned.response?.etaSeconds,
      },
      startedAt: new Date(NOW_MS),
      alreadyStarted: true,
    });
    const points = first.response?.route?.points ?? [];
    expect(points.at(0)).toEqual(away);
    expect(points[expected.pickupIndex]).toEqual(MARKET_LOCATION);
    expect(points.at(-1)).toEqual(DELIVERY);
    expect(expected.pickupIndex).toBeGreaterThan(0);
    expect(second.response).toEqual(first.response);
  });

  it('kurye siparisi biraktiysa StartRoute NOT_FOUND (QA B1); rota gecmis olarak kalir', async () => {
    const request = assignRequest();
    const assigned = await routeCall(service.assignCourier, request);
    const holder = assigned.response?.courier?.id ?? '';
    const before = await routeCall(service.startRoute, {
      orderId: request.orderId,
      courierId: holder,
    });

    await routeCall(service.releaseCourier, { orderId: request.orderId });
    const after = await routeCall(service.startRoute, {
      orderId: request.orderId,
      courierId: holder,
    });

    expect(before.response?.alreadyStarted).toBe(true);
    expect(after.error?.code).toBe(GRPC_STATUS.NOT_FOUND);
    expect(errorCodeOf(after.error)).toBe(ERROR_CODES.NOT_FOUND);
  });

  it('rotasi olmayan siparis ya da baska kurye: NOT_FOUND', async () => {
    const request = assignRequest();
    const assigned = await routeCall(service.assignCourier, request);
    const holder = assigned.response?.courier?.id ?? '';

    const unknown = await routeCall(service.startRoute, { orderId: orderId(), courierId: holder });
    const other = await routeCall(service.startRoute, {
      orderId: request.orderId,
      courierId: courierId(9),
    });

    expect(holder).not.toBe('');
    for (const { error } of [unknown, other]) {
      expect(error?.code).toBe(GRPC_STATUS.NOT_FOUND);
      expect(errorCodeOf(error)).toBe(ERROR_CODES.NOT_FOUND);
    }
  });

  it('kurye hizi disaridan (main: COURIER_SPEED_KMH): 40 km/sa ile ETA o hizla', async () => {
    const fast = await startTestGrpcServer({
      serviceName: 'courier-hiz-test',
      services: [
        buildCourierService({
          couriers: new InMemoryCourierStore([courier(21, { lastLocation: away })]),
          markets: new InMemoryCourierStore([], TEST_MARKETS),
          speedKmh: 40,
          clock: fixedClock(NOW_MS),
        }),
      ],
    });
    try {
      const assigned = await fast.call(service.assignCourier, assignRequest());

      const plan = planRoute(
        { from: away, pickup: MARKET_LOCATION, dropoff: DELIVERY },
        { ...ROUTE_RULE, speedKmh: 40 },
      );
      expect(assigned.response?.etaSeconds).toBe(plan.etaSeconds);
      expect(plan.etaSeconds).toBeLessThan(
        planRoute({ from: away, pickup: MARKET_LOCATION, dropoff: DELIVERY }, ROUTE_RULE)
          .etaSeconds,
      );
    } finally {
      await fast.stop();
    }
  });

  it('sozlesme disi kimlikler INVALID_ARGUMENT', async () => {
    const badOrder = await routeCall(service.startRoute, {
      orderId: 'ord_1',
      courierId: courierId(1),
    });
    const badCourier = await routeCall(service.startRoute, {
      orderId: orderId(),
      courierId: 'crr_x',
    });

    expect(badOrder.error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(badCourier.error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
  });
});
