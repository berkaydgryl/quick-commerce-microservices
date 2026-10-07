/**
 * Uctan uca kapi testi (T13.3): CourierService/GetTracking. Gercek gRPC
 * sunucusu + gercek istemci, bellek deposu, ilerletilebilir saat. Telden gelen
 * cevapta da gizlilik kurali tutar: paket alinmadan konum alani BOS.
 */

import { ERROR_CODES, fixedClock, GRPC_STATUS } from '@getir/core';
import { courierV1 } from '@getir/proto';
import { appErrorOf, startTestGrpcServer } from '@getir/service-kit/testing';
import type { TestGrpcServer, UnaryCall } from '@getir/service-kit/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildCourierService } from '../../src/bootstrap.js';
import { planRoute } from '../../src/domain/route-planner.js';
import { routeSchedule } from '../../src/domain/route-progress.js';
import { InMemoryCourierStore } from '../../src/infrastructure/memory/in-memory-courier-store.js';
import {
  courier,
  DELIVERY,
  MARKET,
  MARKET_LOCATION,
  northOf,
  NOW_MS,
  orderId,
  ROUTE_RULE,
  TEST_MARKETS,
} from '../support/couriers.js';

const RULE = { speedKmh: ROUTE_RULE.speedKmh, prepSeconds: 30 };
/** Kurye marketten 700 m kuzeyde (onceki musterinin kapisi): sizmamali. */
const AWAY = northOf(MARKET_LOCATION, 700);
const SCHEDULE = routeSchedule(
  planRoute({ from: AWAY, pickup: MARKET_LOCATION, dropoff: DELIVERY }, ROUTE_RULE),
  RULE,
);

const clock = fixedClock(NOW_MS);
const service = courierV1.CourierServiceService;
let server: TestGrpcServer | undefined;

const call: UnaryCall = (method, request, metadata) =>
  server === undefined
    ? Promise.reject(new Error('test sunucusu henuz baslamadi'))
    : server.call(method, request, metadata);

async function assign(): Promise<string> {
  const order = orderId();
  const { error } = await call(
    service.assignCourier,
    courierV1.AssignCourierRequest.fromPartial({
      orderId: order,
      marketId: MARKET,
      deliveryLocation: DELIVERY,
    }),
  );
  expect(error).toBeUndefined();
  return order;
}

beforeAll(async () => {
  server = await startTestGrpcServer({
    serviceName: 'courier-takip-test',
    services: [
      buildCourierService({
        couriers: new InMemoryCourierStore([
          courier(31, { lastLocation: AWAY }),
          courier(32, { lastLocation: AWAY }),
          courier(33, { lastLocation: AWAY }),
        ]),
        markets: new InMemoryCourierStore([], TEST_MARKETS),
        prepSeconds: RULE.prepSeconds,
        clock,
      }),
    ],
  });
});

afterAll(async () => {
  await server?.stop();
});

describe('CourierService/GetTracking', () => {
  it('paket alinmadan: TO_MARKET, konum YOK, rota market -> adres, ETA dakikaya yuvarli; sonra TO_CUSTOMER ve DELIVERED', async () => {
    clock.set(NOW_MS);
    const order = await assign();

    const before = await call(service.getTracking, { orderId: order });
    expect(before.error).toBeUndefined();
    expect(before.response).toMatchObject({
      phase: courierV1.TrackingPhase.TRACKING_PHASE_TO_MARKET,
      courierName: 'Kurye 31',
      marketLocation: MARKET_LOCATION,
      deliveryLocation: DELIVERY,
      remainingMeters: Math.round(SCHEDULE.legTwoMeters),
    });
    expect(before.response?.location).toBeUndefined();
    expect(before.response?.route.at(0)).toEqual(MARKET_LOCATION);
    expect(before.response?.route.at(-1)).toEqual(DELIVERY);
    expect((before.response?.etaSeconds ?? 1) % 60).toBe(0);
    expect(JSON.stringify(before.response)).not.toContain(String(AWAY.lat));

    clock.set(NOW_MS + Math.ceil(SCHEDULE.pickupSeconds * 1_000) + 5_000);
    const onTheWay = await call(service.getTracking, { orderId: order });
    expect(onTheWay.response?.phase).toBe(courierV1.TrackingPhase.TRACKING_PHASE_TO_CUSTOMER);
    expect(onTheWay.response?.location).toBeDefined();
    expect(onTheWay.response?.pickedUpAt).toBeInstanceOf(Date);
    expect(onTheWay.response?.at).toEqual(clock.date());

    clock.set(NOW_MS + Math.ceil(SCHEDULE.arrivalSeconds * 1_000) + 1_000);
    const delivered = await call(service.getTracking, { orderId: order });
    expect(delivered.response).toMatchObject({
      phase: courierV1.TrackingPhase.TRACKING_PHASE_DELIVERED,
      location: DELIVERY,
      remainingMeters: 0,
      etaSeconds: 0,
    });
    expect(delivered.response?.deliveredAt).toBeInstanceOf(Date);
  });

  it('rotasi olmayan ya da birakilan siparis NOT_FOUND; bicimsiz kimlik INVALID_ARGUMENT', async () => {
    clock.set(NOW_MS);
    const order = await assign();
    await call(service.releaseCourier, { orderId: order });

    const released = await call(service.getTracking, { orderId: order });
    const unknown = await call(service.getTracking, { orderId: orderId() });
    const invalid = await call(service.getTracking, { orderId: 'ord_1' });

    for (const { error } of [released, unknown]) {
      expect(error?.code).toBe(GRPC_STATUS.NOT_FOUND);
      expect(appErrorOf(error)?.code).toBe(ERROR_CODES.NOT_FOUND);
    }
    expect(invalid.error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(appErrorOf(invalid.error)?.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });
});
