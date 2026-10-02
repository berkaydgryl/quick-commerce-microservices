/**
 * order -> inventory gRPC istemcisi (T11.2), GERCEK tel uzerinden: sahte bir
 * inventory sunucusu ayaga kalkar. Istek cevirisi, requestId iletimi, beklenen
 * sonuclarin (stok yetmedi, kullanicinin aktif kilidi) ayrimi, sonuc sozlugu ve
 * sure siniri denenir.
 */

import { AppError, ERROR_CODES, silentLogger } from '@getir/core';
import type { ErrorCode } from '@getir/core';
import { inventoryV1 } from '@getir/proto';
import { REQUEST_ID_METADATA_KEY, startGrpcServer, toServiceError } from '@getir/service-kit';
import type { GrpcServerHandle } from '@getir/service-kit';
import type { sendUnaryData, ServerUnaryCall } from '@grpc/grpc-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SETTLEMENT } from '../../src/application/stock-reservations.js';
import type { ReserveStockRequest } from '../../src/application/stock-reservations.js';
import { GrpcStockReservations } from '../../src/infrastructure/inventory/grpc-stock-reservations.js';

const TIMEOUT_MS = 200;
const scope = { requestId: 'req_stok_1', logger: silentLogger };
const EXPIRES_AT = new Date('2026-10-02T10:10:00.000Z');

/** Sunucunun gordugu istekler ve x-request-id degerleri. */
const seen: { request: unknown; requestId: unknown }[] = [];

/** Siparis kimligi sahte sunucunun davranisini secer. */
const ORDER = {
  LOCKED: 'ord_kilitli',
  INSUFFICIENT: 'ord_yetersiz',
  USER_ACTIVE: 'ord_aktif',
  USER_ACTIVE_BAD_DETAILS: 'ord_aktif_bozuk',
  NO_EXPIRY: 'ord_bitissiz',
  INVALID: 'ord_gecersiz',
  SLOW: 'ord_yavas',
} as const;

const OUTCOME_BY_ORDER: Readonly<Record<string, inventoryV1.ReservationOutcome>> = {
  ord_applied: inventoryV1.ReservationOutcome.RESERVATION_OUTCOME_APPLIED,
  ord_already: inventoryV1.ReservationOutcome.RESERVATION_OUTCOME_ALREADY_APPLIED,
  ord_not_found: inventoryV1.ReservationOutcome.RESERVATION_OUTCOME_NOT_FOUND,
  ord_unspecified: inventoryV1.ReservationOutcome.RESERVATION_OUTCOME_UNSPECIFIED,
};

function appError(code: ErrorCode, details: Record<string, unknown>) {
  return toServiceError(new AppError(code, 'inventory reddetti', { details }));
}

function record(call: ServerUnaryCall<unknown, unknown>): void {
  seen.push({ request: call.request, requestId: call.metadata.get(REQUEST_ID_METADATA_KEY)[0] });
}

const implementation = {
  reserve: (
    call: ServerUnaryCall<inventoryV1.ReserveRequest, inventoryV1.ReserveResponse>,
    callback: sendUnaryData<inventoryV1.ReserveResponse>,
  ): void => {
    record(call);
    switch (call.request.orderId) {
      case ORDER.INSUFFICIENT:
        callback(
          appError(ERROR_CODES.STOCK_INSUFFICIENT, { sku: 'SUT-1L', requested: 2, available: 1 }),
        );
        return;
      case ORDER.USER_ACTIVE:
        callback(appError(ERROR_CODES.RESERVATION_ACTIVE, { activeOrderId: 'ord_onceki' }));
        return;
      case ORDER.USER_ACTIVE_BAD_DETAILS:
        callback(appError(ERROR_CODES.RESERVATION_ACTIVE, { activeOrderId: 'usr_1' }));
        return;
      case ORDER.INVALID:
        callback(appError(ERROR_CODES.VALIDATION_FAILED, { ttlSeconds: 'aralik disi' }));
        return;
      case ORDER.NO_EXPIRY:
        callback(null, inventoryV1.ReserveResponse.fromPartial({}));
        return;
      case ORDER.SLOW:
        setTimeout(
          () => callback(null, { expiresAt: EXPIRES_AT, alreadyReserved: false }),
          TIMEOUT_MS * 3,
        );
        return;
      default:
        callback(null, { expiresAt: EXPIRES_AT, alreadyReserved: false });
    }
  },
  commit: (
    call: ServerUnaryCall<inventoryV1.CommitRequest, inventoryV1.CommitResponse>,
    callback: sendUnaryData<inventoryV1.CommitResponse>,
  ): void => {
    record(call);
    callback(null, { outcome: OUTCOME_BY_ORDER[call.request.orderId] ?? 0 });
  },
  release: (
    call: ServerUnaryCall<inventoryV1.ReleaseRequest, inventoryV1.ReleaseResponse>,
    callback: sendUnaryData<inventoryV1.ReleaseResponse>,
  ): void => {
    record(call);
    callback(null, { outcome: OUTCOME_BY_ORDER[call.request.orderId] ?? 0 });
  },
};

let handle: GrpcServerHandle;
let stock: GrpcStockReservations;

beforeAll(async () => {
  handle = await startGrpcServer({
    serviceName: 'fake-inventory',
    host: '127.0.0.1',
    port: 0,
    services: [
      {
        name: 'getir.inventory.v1.InventoryService',
        definition: inventoryV1.InventoryServiceService,
        implementation,
      },
    ],
  });
  stock = new GrpcStockReservations(`127.0.0.1:${handle.port}`, TIMEOUT_MS);
});

afterAll(async () => {
  stock?.close();
  await handle?.shutdown('test bitti');
});

const reserveRequest = (orderId: string = ORDER.LOCKED): ReserveStockRequest => ({
  orderId,
  userId: 'usr_1',
  marketId: 'mkt_migros-jet-moda',
  lines: [{ sku: 'SUT-1L', quantity: 2 }],
  ttlSeconds: 600,
});

async function rejectionOf(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (error instanceof AppError) return error;
  throw new Error('AppError beklenirdi');
}

describe('GrpcStockReservations.reserve', () => {
  it('kalemler, kullanici, market ve omur telde; bitis ani doner; requestId AYNEN iletilir', async () => {
    await expect(stock.reserve(reserveRequest(), scope)).resolves.toEqual({
      kind: 'reserved',
      expiresAt: EXPIRES_AT,
    });

    expect(seen.at(-1)).toEqual({
      request: inventoryV1.ReserveRequest.fromPartial({
        orderId: ORDER.LOCKED,
        userId: 'usr_1',
        marketId: 'mkt_migros-jet-moda',
        items: [{ sku: 'SUT-1L', quantity: 2 }],
        ttlSeconds: 600,
      }),
      requestId: scope.requestId,
    });
  });

  it('stok yetmedi: hata degil SONUC; inventory ayrintisi (sku, istenen, kalan) korunur', async () => {
    const outcome = await stock.reserve(reserveRequest(ORDER.INSUFFICIENT), scope);

    expect(outcome.kind).toBe('insufficient');
    expect(outcome.kind === 'insufficient' && outcome.error).toMatchObject({
      code: ERROR_CODES.STOCK_INSUFFICIENT,
      details: { sku: 'SUT-1L', requested: 2, available: 1 },
    });
  });

  it('kullanicinin aktif kilidi: SONUC, kilidi tutan siparis kimligiyle', async () => {
    const outcome = await stock.reserve(reserveRequest(ORDER.USER_ACTIVE), scope);

    expect(outcome).toMatchObject({ kind: 'user-has-active', activeOrderId: 'ord_onceki' });
  });

  it('aktif kilit ayrintisi siparis kimligi degilse sonuca cevrilmez: hata AYNEN yukari', async () => {
    const error = await rejectionOf(
      stock.reserve(reserveRequest(ORDER.USER_ACTIVE_BAD_DETAILS), scope),
    );

    expect(error.code).toBe(ERROR_CODES.RESERVATION_ACTIVE);
  });

  it('beklenmeyen hata (gecersiz istek) AYNEN yukari gider', async () => {
    const error = await rejectionOf(stock.reserve(reserveRequest(ORDER.INVALID), scope));

    expect(error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('bitis anisiz cevapla kilit varsayilmaz: INTERNAL', async () => {
    const error = await rejectionOf(stock.reserve(reserveRequest(ORDER.NO_EXPIRY), scope));

    expect(error.code).toBe(ERROR_CODES.INTERNAL);
  });

  it('sure siniri dolarsa SERVICE_UNAVAILABLE', async () => {
    const error = await rejectionOf(stock.reserve(reserveRequest(ORDER.SLOW), scope));

    expect(error.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
  });
});

describe('GrpcStockReservations.commit / release', () => {
  it.each([
    ['ord_applied', SETTLEMENT.APPLIED],
    ['ord_already', SETTLEMENT.ALREADY_APPLIED],
    ['ord_not_found', SETTLEMENT.NOT_FOUND],
  ])('%s: sonuc sozluge cevrilir (%s)', async (orderId, settlement) => {
    const request = { orderId, marketId: 'mkt_migros-jet-moda' };

    await expect(stock.commit(request, scope)).resolves.toBe(settlement);
    await expect(stock.release({ ...request, reason: 'user_cancelled' }, scope)).resolves.toBe(
      settlement,
    );
  });

  it('birakma gerekcesi ve market telde; requestId AYNEN iletilir', async () => {
    await stock.release(
      { orderId: 'ord_applied', marketId: 'mkt_migros-jet-moda', reason: 'payment_failed' },
      scope,
    );

    expect(seen.at(-1)).toEqual({
      request: inventoryV1.ReleaseRequest.fromPartial({
        orderId: 'ord_applied',
        marketId: 'mkt_migros-jet-moda',
        reason: 'payment_failed',
      }),
      requestId: scope.requestId,
    });
  });

  it('anlami bilinmeyen sonucla stok hareketi varsayilmaz: INTERNAL', async () => {
    const error = await rejectionOf(
      stock.commit({ orderId: 'ord_unspecified', marketId: 'mkt_migros-jet-moda' }, scope),
    );

    expect(error.code).toBe(ERROR_CODES.INTERNAL);
  });
});
