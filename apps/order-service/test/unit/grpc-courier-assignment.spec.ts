/**
 * order -> courier gRPC istemcisi (T13.1 PR 2), GERCEK tel uzerinden: sahte bir
 * courier sunucusu ayaga kalkar. Istek cevirisi (market, teslimat konumu, eski
 * dark_store_id bos), bos kurye yoksa null, birakmanin sonucu, requestId
 * iletimi ve D17 (iki cagri da tekrar guvenli: yeniden denenir; devre).
 */

import { AppError, ERROR_CODES, silentLogger } from '@getir/core';
import { courierV1 } from '@getir/proto';
import {
  CircuitBreaker,
  REQUEST_ID_METADATA_KEY,
  startGrpcServer,
  toServiceError,
} from '@getir/service-kit';
import type { GrpcServerHandle } from '@getir/service-kit';
import type { sendUnaryData, ServerUnaryCall } from '@grpc/grpc-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GrpcCourierAssignment } from '../../src/infrastructure/courier/grpc-courier-assignment.js';
import {
  cutAfterReach,
  DEADLINE_TIMEOUT_MS,
  FUNCTIONAL_TIMEOUT_MS,
  HeldReplies,
  REACH_BUDGET_MS,
} from '../support/held-replies.js';
import { businessError, UNAVAILABLE, withProbe } from '../support/qa-breaker-probe.js';

const scope = { requestId: 'req_kurye_1', logger: silentLogger };
const LOCATION = { lat: 40.9885, lng: 29.0262 };
const SLOW_ORDER_ID = 'ord_yavas';
/** Yavas siparisin bekletilen istekleri (cevap verilmez; kimlik ve kalan sure kaydedilir). */
const held = new HeldReplies();

const seenAssigns: courierV1.AssignCourierRequest[] = [];
const seenReleases: courierV1.ReleaseCourierRequest[] = [];
const seenRequestIds: unknown[] = [];
/** Ilk cagrisi "ulasilamaz" donen siparisler (D17): siparis -> gorulen cagri sayisi. */
const flakyCalls = new Map<string, number>();

/** Siparis "ord_kesik..." ise ilk cagri SERVICE_UNAVAILABLE ile duser. */
function failsFirst(orderId: string): boolean {
  if (!orderId.startsWith('ord_kesik')) return false;
  const seen = (flakyCalls.get(orderId) ?? 0) + 1;
  flakyCalls.set(orderId, seen);
  return seen === 1;
}

const unavailable = () =>
  toServiceError(new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'courier gecici olarak kapali'));

const courierOf = (id: string): courierV1.Courier =>
  courierV1.Courier.fromPartial({
    id,
    name: 'Mehmet K.',
    marketId: 'mkt_migros-jet-moda',
    status: courierV1.CourierStatus.COURIER_STATUS_BUSY,
  });

const implementation = {
  assignCourier: (
    call: ServerUnaryCall<courierV1.AssignCourierRequest, courierV1.AssignCourierResponse>,
    callback: sendUnaryData<courierV1.AssignCourierResponse>,
  ): void => {
    // Yavas siparis kayda YAZILMADAN bekletilir: gec gelen deneme baska testin at(-1)'ini bozmasin.
    if (call.request.orderId === SLOW_ORDER_ID) {
      held.hold(call);
      return;
    }
    seenAssigns.push(call.request);
    seenRequestIds.push(call.metadata.get(REQUEST_ID_METADATA_KEY)[0]);
    const { orderId } = call.request;
    if (failsFirst(orderId)) {
      callback(unavailable());
      return;
    }
    if (orderId === 'ord_bos_kurye_yok') {
      callback(toServiceError(AppError.notFound('Markette uygun kurye yok')));
      return;
    }
    if (orderId === 'ord_gecersiz') {
      callback(toServiceError(AppError.validation('market_id zorunlu')));
      return;
    }
    if (orderId === 'ord_kuryesiz_cevap') {
      callback(null, { courier: undefined, etaSeconds: 0 });
      return;
    }
    callback(null, { courier: courierOf('crr_1'), etaSeconds: 0 });
  },
  getCourier: (
    _call: ServerUnaryCall<courierV1.GetCourierRequest, courierV1.GetCourierResponse>,
    callback: sendUnaryData<courierV1.GetCourierResponse>,
  ): void => {
    callback(toServiceError(AppError.notFound('yok')));
  },
  startRoute: (
    _call: ServerUnaryCall<courierV1.StartRouteRequest, courierV1.StartRouteResponse>,
    callback: sendUnaryData<courierV1.StartRouteResponse>,
  ): void => {
    callback(toServiceError(new AppError(ERROR_CODES.NOT_IMPLEMENTED, 'T13.2')));
  },
  releaseCourier: (
    call: ServerUnaryCall<courierV1.ReleaseCourierRequest, courierV1.ReleaseCourierResponse>,
    callback: sendUnaryData<courierV1.ReleaseCourierResponse>,
  ): void => {
    seenReleases.push(call.request);
    seenRequestIds.push(call.metadata.get(REQUEST_ID_METADATA_KEY)[0]);
    if (failsFirst(call.request.orderId)) {
      callback(unavailable());
      return;
    }
    const released = call.request.orderId === 'ord_tasiniyor';
    callback(null, { released, courierId: released ? 'crr_1' : '' });
  },
};

let handle: GrpcServerHandle;
let client: GrpcCourierAssignment;

beforeAll(async () => {
  handle = await startGrpcServer({
    serviceName: 'fake-courier',
    host: '127.0.0.1',
    port: 0,
    services: [
      {
        name: 'getir.courier.v1.CourierService',
        definition: courierV1.CourierServiceService,
        implementation,
      },
    ],
  });
  client = new GrpcCourierAssignment(`127.0.0.1:${handle.port}`, FUNCTIONAL_TIMEOUT_MS);
});

afterAll(async () => {
  client?.close();
  await handle?.shutdown('test bitti');
});

const request = (orderId: string) => ({
  orderId,
  marketId: 'mkt_migros-jet-moda',
  deliveryLocation: LOCATION,
});

async function rejectionOf(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (error instanceof AppError) return error;
  throw new Error('AppError beklenirdi');
}

describe('GrpcCourierAssignment.assign', () => {
  it('istek telde birebir (market, teslimat konumu, eski alan bos); requestId AYNEN iletilir', async () => {
    await expect(client.assign(request('ord_1'), scope)).resolves.toEqual({ courierId: 'crr_1' });

    expect(seenAssigns.at(-1)).toEqual({
      orderId: 'ord_1',
      darkStoreId: '',
      marketId: 'mkt_migros-jet-moda',
      deliveryLocation: LOCATION,
    });
    expect(seenRequestIds.at(-1)).toBe('req_kurye_1');
  });

  it('markette bos kurye yok (NOT_FOUND): hata degil, null', async () => {
    await expect(client.assign(request('ord_bos_kurye_yok'), scope)).resolves.toBeNull();
  });

  it('kuryesiz cevapla siparis ilerletilmez: INTERNAL', async () => {
    const error = await rejectionOf(client.assign(request('ord_kuryesiz_cevap'), scope));
    expect(error.code).toBe(ERROR_CODES.INTERNAL);
  });

  it('courier-svc is hatasi AYNEN yukari gider', async () => {
    const error = await rejectionOf(client.assign(request('ord_gecersiz'), scope));
    expect(error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });
});

describe('GrpcCourierAssignment.release', () => {
  it('tasiyan kurye birakildi: true; tasiyan yok: false (tekrar guvenli)', async () => {
    await expect(client.release('ord_tasiniyor', scope)).resolves.toBe(true);
    await expect(client.release('ord_bos', scope)).resolves.toBe(false);
    expect(seenReleases.at(-1)).toEqual({ orderId: 'ord_bos' });
    expect(seenRequestIds.at(-1)).toBe('req_kurye_1');
  });
});

describe('GrpcCourierAssignment - dayaniklilik (D17)', () => {
  const resilience = () => ({
    breaker: new CircuitBreaker({ target: 'courier', failureThreshold: 2, openMs: 60_000 }),
    retry: { target: 'courier', maxRetries: 2, baseDelayMs: 1 },
  });
  const connectCourier = (address: string) =>
    new GrpcCourierAssignment(address, FUNCTIONAL_TIMEOUT_MS, resilience());
  let resilient: GrpcCourierAssignment;

  beforeAll(() => {
    resilient = new GrpcCourierAssignment(
      `127.0.0.1:${handle.port}`,
      FUNCTIONAL_TIMEOUT_MS,
      resilience(),
    );
  });

  afterAll(() => {
    resilient?.close();
  });

  it('atama tekrar guvenli: ilk deneme duserse yeniden denenir ve kurye doner', async () => {
    await expect(resilient.assign(request('ord_kesik_atama'), scope)).resolves.toEqual({
      courierId: 'crr_1',
    });
    expect(flakyCalls.get('ord_kesik_atama')).toBe(2);
  });

  it('birakma tekrar guvenli: ilk deneme duserse yeniden denenir', async () => {
    await expect(resilient.release('ord_kesik_birakma', scope)).resolves.toBe(false);
    expect(flakyCalls.get('ord_kesik_birakma')).toBe(2);
  });

  it('ulasilamayan courier a ust uste hatadan sonra devre acilir; cagri ag a gitmeden hemen reddedilir', async () => {
    // Kanit sunucu sayaci (#123): kapali port ve hiz olcumu kesicisiz de geciyordu.
    await withProbe(
      'courier',
      courierV1.CourierServiceService,
      connectCourier,
      async (client, faults) => {
        faults.setAll(UNAVAILABLE);
        await rejectionOf(client.assign(request('ord_1'), scope));
        const reached = faults.calls();

        const rejected = await rejectionOf(client.release('ord_1', scope));

        expect(rejected.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
        expect(faults.calls()).toBe(reached);
      },
    );
  });

  it('bos kurye yok (NOT_FOUND) devreyi ACMAZ: beklenen sonuc', async () => {
    await withProbe(
      'courier',
      courierV1.CourierServiceService,
      connectCourier,
      async (client, faults) => {
        faults.set('assignCourier', businessError(ERROR_CODES.NOT_FOUND));
        for (let i = 0; i < 4; i += 1) {
          await expect(client.assign(request('ord_bos_kurye_yok'), scope)).resolves.toBeNull();
        }
        // Esik 2, dort is hatasi: hepsi sunucuya ulasti.
        expect(faults.calls('assignCourier')).toBe(4);

        // Iki yonlu kanit (#123): ayni istemcide devre gercekten acilabiliyor.
        faults.setAll(UNAVAILABLE);
        await rejectionOf(client.assign(request('ord_bos_kurye_yok'), scope));
        const reached = faults.calls();
        await rejectionOf(client.release('ord_bos_kurye_yok', scope));
        expect(faults.calls()).toBe(reached);
      },
    );
  });
});

describe('GrpcCourierAssignment sure siniri (#113)', () => {
  let shortDeadline: GrpcCourierAssignment;

  beforeAll(() => {
    shortDeadline = new GrpcCourierAssignment(`127.0.0.1:${handle.port}`, DEADLINE_TIMEOUT_MS);
  });

  afterAll(() => {
    shortDeadline?.close();
  });

  it('sure siniri dolarsa SERVICE_UNAVAILABLE; istemci KENDI kisa sinirini gonderir', async () => {
    const { error, reply } = await cutAfterReach(
      (requestId) =>
        shortDeadline.assign(request(SLOW_ORDER_ID), { requestId, logger: silentLogger }),
      held,
      REACH_BUDGET_MS,
    );

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
    // Istek sunucuya ulasti ve istemci kendi kisa sinirini gonderdi.
    expect(reply.remainingMs).toBeLessThanOrEqual(DEADLINE_TIMEOUT_MS);
  });
});
