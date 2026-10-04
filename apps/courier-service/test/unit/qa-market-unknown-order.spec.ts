/**
 * QA kara kutu (T13.2 PR 1): courier'in market kopyasinda OLMAYAN market (yeni acilmis
 * market, kopya henuz guncellenmemis; bekleyen is #93). GERCEK courier-svc gRPC ile,
 * GERCEK order iscisi (uretimdeki istemci: 1 sn sure, D17 devre ve yeniden deneme).
 * Iki taraf da bellekte.
 *
 * Beklenen: courier NOT_FOUND (reason market_unknown) doner; order bunu "kurye yok"
 * sayar, siparis kuryesiz bekler ve deneme aninda yeniden ister; kurye baglanmaz;
 * devre ACILMAZ (bilinen marketin siparisi ayni anda atanir).
 *
 * Yalnizca davranis: order'in sirasi (#92) ve gunluk metni (D1-D3) order'in sonraki
 * PR'inda degisir, burada kilitlenmez.
 */

import { fixedClock, ORDER_STATUS, silentLogger } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { courierV1 } from '@getir/proto';
import { afterEach, describe, expect, it } from 'vitest';

import { createDispatchCouriers } from '../../../order-service/src/application/dispatch-couriers.js';
import {
  COURIER_ASSIGNMENT_WRITE_ATTEMPTS,
  COURIER_CALL_TIMEOUT_MS,
  COURIER_DISPATCH_BATCH_SIZE,
  COURIER_RETRY_DELAY_MS,
  DEPENDENCY_BREAKER_FAILURE_THRESHOLD,
} from '../../../order-service/src/config/constants.js';
import { GrpcCourierAssignment } from '../../../order-service/src/infrastructure/courier/grpc-courier-assignment.js';
import {
  DEPENDENCY,
  dependencyResilience,
} from '../../../order-service/src/infrastructure/grpc-resilience.js';
import { openOrderStore } from '../../../order-service/src/infrastructure/order-store.js';
import { insertPaid } from '../../../order-service/test/support/order-builders.js';
import { InMemoryCourierStore } from '../../src/infrastructure/memory/in-memory-courier-store.js';
import { courier, courierId, MARKET, NOW_MS, TEST_MARKETS } from '../support/couriers.js';
import { startQaCourierServer } from '../support/qa-courier-harness.js';
import type { QaCourierServer } from '../support/qa-courier-harness.js';

/** Bicimi gecerli, katalogda yeni, courier'in kopyasinda yok. */
const NEW_MARKET = 'mkt_yeni-acilan-market';
const DELIVERY = { lat: 40.99, lng: 29.03 } as const;

let server: QaCourierServer | undefined;
let client: GrpcCourierAssignment | undefined;

afterEach(async () => {
  client?.close();
  await server?.stop();
  server = undefined;
  client = undefined;
});

describe('QA T13.2 kopyada olmayan market: gercek courier + order iscisi', () => {
  it('siparis kuryesiz bekler ve deneme aninda yeniden ister; kurye baglanmaz; devre acilmaz, bilinen marketin siparisi atanir', async () => {
    const clock = fixedClock(NOW_MS);
    const courierLines: LogLine[] = [];
    // Kopyada yalnizca test marketleri: NEW_MARKET yok.
    const store = new InMemoryCourierStore([courier(1), courier(2)], TEST_MARKETS);
    server = await startQaCourierServer({
      repository: store,
      markets: store,
      clock,
      logger: recordingLogger(courierLines),
    });
    client = new GrpcCourierAssignment(
      `127.0.0.1:${server.server.handle.port}`,
      COURIER_CALL_TIMEOUT_MS,
      dependencyResilience(DEPENDENCY.COURIER, silentLogger),
    );
    const orders = await openOrderStore(undefined, silentLogger, 'test');
    const tour = createDispatchCouriers({
      awaiting: orders.awaitingCourier,
      repository: orders.repository,
      courier: client,
      clock,
      batchSize: COURIER_DISPATCH_BATCH_SIZE,
      retryDelayMs: COURIER_RETRY_DELAY_MS,
      writeAttempts: COURIER_ASSIGNMENT_WRITE_ATTEMPTS,
    });
    const stranded = await insertPaid(orders.repository, clock, {
      marketId: NEW_MARKET,
      deliveryLocation: DELIVERY,
    });
    /** courier'in bu siparis icin "market bilinmiyor" dedigi istekler. */
    const unknownAnswers = () =>
      courierLines.filter(
        (line) =>
          line.level === 'warn' &&
          line.fields.orderId === stranded.id &&
          line.fields.marketId === NEW_MARKET,
      ).length;

    // Devre esigini asacak kadar deneme: her turdan sonra deneme ani gelir.
    const tours = DEPENDENCY_BREAKER_FAILURE_THRESHOLD + 2;
    const states = [];
    for (let index = 0; index < tours; index += 1) {
      await tour(silentLogger);
      const now = await orders.repository.findById(stranded.id);
      states.push({ status: now?.status, courier: now?.courier });
      clock.advance(COURIER_RETRY_DELAY_MS + 1_000);
    }
    const asked = unknownAnswers();
    const known = await insertPaid(orders.repository, clock, {
      marketId: MARKET,
      deliveryLocation: DELIVERY,
    });
    await tour(silentLogger);
    const knownNow = await orders.repository.findById(known.id);
    const first = await server.get(courierId(1));
    const second = await server.get(courierId(2));

    expect(states).toEqual(
      Array.from({ length: tours }, () => ({ status: ORDER_STATUS.PREPARING, courier: undefined })),
    );
    // Bekleyen siparis yeniden istenir: her deneme aninda courier'e gider.
    expect(asked).toBeGreaterThanOrEqual(tours);
    // Devre acilmadi: bilinen marketin siparisi hemen atanir.
    expect(knownNow?.courier?.courierId).toBe(courierId(1));
    expect([first.response?.courier?.currentOrderId, second.response?.courier?.status]).toEqual([
      known.id,
      courierV1.CourierStatus.COURIER_STATUS_IDLE,
    ]);
  });
});
