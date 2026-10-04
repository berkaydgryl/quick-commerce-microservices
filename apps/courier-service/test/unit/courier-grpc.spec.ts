/**
 * Uctan uca kapi testi: gercek gRPC sunucusu + gercek istemci, bellek deposu.
 * Sozlesme: dogrulama (INVALID_ARGUMENT), NOT_FOUND, tekrar guvenligi,
 * kullanimdan kalkan dark_store_id ve StartRoute'un NOT_IMPLEMENTED'i.
 */

import { ERROR_CODES, fixedClock, GRPC_STATUS } from '@getir/core';
import { courierV1 } from '@getir/proto';
import { appErrorOf, startTestGrpcServer } from '@getir/service-kit/testing';
import type { TestGrpcServer, UnaryCall } from '@getir/service-kit/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildCourierService } from '../../src/bootstrap.js';
import { COURIER_STATUS } from '../../src/domain/courier.js';
import { InMemoryCourierStore } from '../../src/infrastructure/memory/in-memory-courier-store.js';
import {
  courier,
  courierId,
  DELIVERY,
  MARKET,
  NOW_MS,
  orderId,
  OTHER_MARKET,
  SEEDED_AT,
} from '../support/couriers.js';

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
          courier(3, { marketId: OTHER_MARKET }),
          courier(4, { marketId: 'mkt_kardesler-manavi', status: COURIER_STATUS.OFFLINE }),
        ]),
        clock: fixedClock(NOW_MS),
      }),
    ],
  });
});

afterAll(async () => {
  await server?.stop();
});

describe('CourierService/AssignCourier', () => {
  it('kuryeyi atar: BUSY, siparise bagli; dark_store_id bos, ETA 0 (T13.2)', async () => {
    const request = assignRequest();

    const { error, response } = await call(service.assignCourier, request);

    expect(error).toBeUndefined();
    expect(response).toEqual({
      courier: {
        id: courierId(1),
        name: 'Kurye 1',
        darkStoreId: '',
        marketId: MARKET,
        status: courierV1.CourierStatus.COURIER_STATUS_BUSY,
        currentOrderId: request.orderId,
        lastLocation: { lat: 40.985, lng: 29.0275 },
        lastLocationAt: SEEDED_AT,
      },
      etaSeconds: 0,
    });
  });

  it('ayni siparisin tekrari ayni kuryeyi doner; kullanimdan kalkan dark_store_id okunmaz', async () => {
    const request = assignRequest({ marketId: OTHER_MARKET, darkStoreId: 'ds_eski' });

    const first = await call(service.assignCourier, request);
    const second = await call(service.assignCourier, request);

    expect(first.response?.courier?.id).toBe(courierId(3));
    expect(second.response).toEqual(first.response);
  });

  it('markette bos kurye kalmazsa NOT_FOUND', async () => {
    const { error } = await call(
      service.assignCourier,
      assignRequest({ marketId: 'mkt_kardesler-manavi' }),
    );

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
  it('henuz yok: UNIMPLEMENTED + NOT_IMPLEMENTED, mesaj gorevi soyler', async () => {
    const { error } = await call(service.startRoute, {
      orderId: orderId(),
      courierId: courierId(1),
    });

    expect(error?.code).toBe(GRPC_STATUS.UNIMPLEMENTED);
    expect(errorCodeOf(error)).toBe(ERROR_CODES.NOT_IMPLEMENTED);
    expect(error?.details).toContain('T13.2');
  });
});
