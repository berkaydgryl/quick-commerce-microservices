/**
 * order -> inventory gRPC istemcisi (T11.2; uzatma ve kisaltma T11.3), GERCEK
 * tel uzerinden: sahte bir inventory sunucusu ayaga kalkar. Istek cevirisi,
 * requestId iletimi, beklenen sonuclarin (stok yetmedi, kullanicinin aktif
 * kilidi, kilidin dusmesi) ayrimi, sonuc sozlugu ve sure siniri denenir.
 *
 * Sure siniri yuke bagli olmasin (#98): davranis testleri bol sureli
 * istemciyle kosar; sure siniri testinin kendi kisa sureli istemcisi vardir ve
 * yavas sunucu CEVAP VERMEZ (test bitince birakilir). Iki surenin orani yerine
 * "cevap hic gelmedi" olayina dayanir.
 */

import { AppError, ERROR_CODES, silentLogger } from '@getir/core';
import type { ErrorCode } from '@getir/core';
import { inventoryV1 } from '@getir/proto';
import {
  CircuitBreaker,
  REQUEST_ID_METADATA_KEY,
  startGrpcServer,
  toServiceError,
} from '@getir/service-kit';
import type { GrpcServerHandle } from '@getir/service-kit';
import type { sendUnaryData, ServerUnaryCall } from '@grpc/grpc-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SETTLEMENT } from '../../src/application/stock-reservations.js';
import type { ReserveStockRequest } from '../../src/application/stock-reservations.js';
import { GrpcStockReservations } from '../../src/infrastructure/inventory/grpc-stock-reservations.js';

/** Davranis testleri: yuklu makinede de asilmayacak kadar bol. */
const CALL_TIMEOUT_MS = 5_000;
/** Yalnizca sure siniri testinin istemcisi. */
const SHORT_TIMEOUT_MS = 200;
const scope = { requestId: 'req_stok_1', logger: silentLogger };
const EXPIRES_AT = new Date('2026-10-02T10:10:00.000Z');
/** Siparisin bildigi kilit bitisi: uzatmada beklenen bitis olarak gider (T15.3). */
const EXPECTED = new Date('2026-10-02T10:09:00.000Z');

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
  /** Ilk Reserve'u "ulasilamaz" doner (D17). */
  FLAKY: 'ord_kesik',
  /** Uzatma hakki bitmis ya da kalan sure zaten kisa (T11.3). */
  UNCHANGED: 'ord_degismedi',
  /** Kilit dusmus: RESERVATION_EXPIRED (T11.3). */
  LAPSED: 'ord_dustu',
  /** Beklenen bitis tutmadi (T15.3): expiry_mismatch. */
  MOVED: 'ord_kaydi',
} as const;
/** Yavas sunucunun bekletilen cevaplari: test sonunda birakilir. */
const heldSlowReplies: (() => void)[] = [];
let flakyReserves = 0;
let flakyExtends = 0;
let flakyShortens = 0;

/** Uzatma ve kisaltmanin ortak davranisi: siparise gore hata ya da bitisi olmayan cevap. */
function timingFailure(orderId: string) {
  switch (orderId) {
    case ORDER.LAPSED:
      return appError(ERROR_CODES.RESERVATION_EXPIRED, { orderId, reason: 'absent' });
    case ORDER.INVALID:
      return appError(ERROR_CODES.VALIDATION_FAILED, { additionalSeconds: 'aralik disi' });
    default:
      return undefined;
  }
}

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
    if (call.request.orderId === ORDER.FLAKY) {
      flakyReserves += 1;
      if (flakyReserves === 1) {
        callback(appError(ERROR_CODES.SERVICE_UNAVAILABLE, {}));
        return;
      }
    }
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
        // Cevap istemcinin suresi icinde HIC gelmez: sure siniri oranla degil olayla.
        heldSlowReplies.push(() =>
          callback(null, { expiresAt: EXPIRES_AT, alreadyReserved: false }),
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
  extendReservation: (
    call: ServerUnaryCall<
      inventoryV1.ExtendReservationRequest,
      inventoryV1.ExtendReservationResponse
    >,
    callback: sendUnaryData<inventoryV1.ExtendReservationResponse>,
  ): void => {
    record(call);
    const { orderId } = call.request;
    if (orderId === ORDER.FLAKY) {
      // Ilk cagri uygulanir ama cevabi kaybolur; tekrar bitisi degismis bulur (T15.3).
      flakyExtends += 1;
      if (flakyExtends === 1) {
        callback(appError(ERROR_CODES.SERVICE_UNAVAILABLE, {}));
        return;
      }
    }
    const failure = timingFailure(orderId);
    if (failure !== undefined) {
      callback(failure);
      return;
    }
    if (orderId === ORDER.NO_EXPIRY) {
      callback(null, inventoryV1.ExtendReservationResponse.fromPartial({}));
      return;
    }
    const unchanged = orderId === ORDER.UNCHANGED;
    callback(null, {
      expiresAt: EXPIRES_AT,
      alreadyExtended: unchanged,
      extensionCount: unchanged ? 3 : 1,
      expiryMismatch: orderId === ORDER.MOVED || orderId === ORDER.FLAKY,
    });
  },
  shortenReservation: (
    call: ServerUnaryCall<
      inventoryV1.ShortenReservationRequest,
      inventoryV1.ShortenReservationResponse
    >,
    callback: sendUnaryData<inventoryV1.ShortenReservationResponse>,
  ): void => {
    record(call);
    const { orderId } = call.request;
    if (orderId === ORDER.FLAKY) {
      flakyShortens += 1;
      if (flakyShortens === 1) {
        callback(appError(ERROR_CODES.SERVICE_UNAVAILABLE, {}));
        return;
      }
    }
    const failure = timingFailure(orderId);
    if (failure !== undefined) {
      callback(failure);
      return;
    }
    callback(null, { expiresAt: EXPIRES_AT, shortened: orderId !== ORDER.UNCHANGED });
  },
};

let handle: GrpcServerHandle;
let stock: GrpcStockReservations;
let shortStock: GrpcStockReservations;

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
  stock = new GrpcStockReservations(`127.0.0.1:${handle.port}`, CALL_TIMEOUT_MS);
  shortStock = new GrpcStockReservations(`127.0.0.1:${handle.port}`, SHORT_TIMEOUT_MS);
});

afterAll(async () => {
  for (const reply of heldSlowReplies.splice(0)) reply();
  stock?.close();
  shortStock?.close();
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

  it('sure siniri dolarsa SERVICE_UNAVAILABLE (sunucu cevap vermez)', async () => {
    const error = await rejectionOf(shortStock.reserve(reserveRequest(ORDER.SLOW), scope));

    expect(error.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
    expect(heldSlowReplies.length).toBeGreaterThan(0);
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

describe('GrpcStockReservations - dayaniklilik (D17)', () => {
  it('Reserve siparise gore tekrar guvenli: ilk deneme duserse yeniden denenir, kilit alinir', async () => {
    const resilient = new GrpcStockReservations(`127.0.0.1:${handle.port}`, 1_000, {
      breaker: new CircuitBreaker({ target: 'inventory', failureThreshold: 5, openMs: 60_000 }),
      retry: { target: 'inventory', maxRetries: 2, baseDelayMs: 1 },
    });
    try {
      await expect(resilient.reserve(reserveRequest(ORDER.FLAKY), scope)).resolves.toEqual({
        kind: 'reserved',
        expiresAt: EXPIRES_AT,
      });
      expect(flakyReserves).toBe(2);
    } finally {
      resilient.close();
    }
  });
});

describe('GrpcStockReservations.extend / shorten (T11.3)', () => {
  const MARKET = 'mkt_migros-jet-moda';

  it('uzatma: siparis, market ve ek sure telde; yeni bitis ve "degisti"; requestId AYNEN iletilir', async () => {
    seen.length = 0;

    await expect(
      stock.extend(
        {
          orderId: ORDER.LOCKED,
          marketId: MARKET,
          additionalSeconds: 60,
          expectedExpiresAt: EXPECTED,
        },
        scope,
      ),
    ).resolves.toEqual({ kind: 'active', expiresAt: EXPIRES_AT, changed: true });
    expect(seen).toEqual([
      {
        request: expect.objectContaining({
          orderId: ORDER.LOCKED,
          marketId: MARKET,
          additionalSeconds: 60,
          expectedExpiresAt: EXPECTED,
        }) as unknown,
        requestId: 'req_stok_1',
      },
    ]);
  });

  it('beklenen bitis tutmadi (T15.3): moved ve guncel bitis; sureye dokunulmadi', async () => {
    await expect(
      stock.extend(
        {
          orderId: ORDER.MOVED,
          marketId: MARKET,
          additionalSeconds: 60,
          expectedExpiresAt: EXPECTED,
        },
        scope,
      ),
    ).resolves.toEqual({ kind: 'moved', expiresAt: EXPIRES_AT });
  });

  it('uzatma hakki bitmis: kilit duruyor ama sure degismedi (changed=false)', async () => {
    await expect(
      stock.extend(
        {
          orderId: ORDER.UNCHANGED,
          marketId: MARKET,
          additionalSeconds: 60,
          expectedExpiresAt: EXPECTED,
        },
        scope,
      ),
    ).resolves.toEqual({ kind: 'active', expiresAt: EXPIRES_AT, changed: false });
  });

  it('kisaltma: siparis, market ve sinir telde; kalan sure zaten kisaysa changed=false', async () => {
    seen.length = 0;

    await expect(
      stock.shorten({ orderId: ORDER.LOCKED, marketId: MARKET, maxRemainingSeconds: 120 }, scope),
    ).resolves.toEqual({ kind: 'active', expiresAt: EXPIRES_AT, changed: true });
    expect(seen[0]?.request).toMatchObject({ orderId: ORDER.LOCKED, maxRemainingSeconds: 120 });
    await expect(
      stock.shorten(
        { orderId: ORDER.UNCHANGED, marketId: MARKET, maxRemainingSeconds: 120 },
        scope,
      ),
    ).resolves.toEqual({ kind: 'active', expiresAt: EXPIRES_AT, changed: false });
  });

  it('kilit dusmus (RESERVATION_EXPIRED): hata degil SONUC, iki cagride de lapsed', async () => {
    await expect(
      stock.extend(
        {
          orderId: ORDER.LAPSED,
          marketId: MARKET,
          additionalSeconds: 60,
          expectedExpiresAt: EXPECTED,
        },
        scope,
      ),
    ).resolves.toEqual({ kind: 'lapsed' });
    await expect(
      stock.shorten({ orderId: ORDER.LAPSED, marketId: MARKET, maxRemainingSeconds: 120 }, scope),
    ).resolves.toEqual({ kind: 'lapsed' });
  });

  it('beklenmeyen hata AYNEN yukari; bitis anisiz cevapla sure varsayilmaz: INTERNAL', async () => {
    const invalid = await rejectionOf(
      stock.extend(
        {
          orderId: ORDER.INVALID,
          marketId: MARKET,
          additionalSeconds: 60,
          expectedExpiresAt: EXPECTED,
        },
        scope,
      ),
    );
    const noExpiry = await rejectionOf(
      stock.extend(
        {
          orderId: ORDER.NO_EXPIRY,
          marketId: MARKET,
          additionalSeconds: 60,
          expectedExpiresAt: EXPECTED,
        },
        scope,
      ),
    );

    expect(invalid.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(noExpiry.code).toBe(ERROR_CODES.INTERNAL);
  });

  it('D17 ve T15.3: uzatma beklenen bitisle yeniden denenir; tekrar guncel bitisi alir (moved), kisaltma da denenir', async () => {
    const resilient = new GrpcStockReservations(`127.0.0.1:${handle.port}`, 1_000, {
      breaker: new CircuitBreaker({ target: 'inventory', failureThreshold: 5, openMs: 60_000 }),
      retry: { target: 'inventory', maxRetries: 2, baseDelayMs: 1 },
    });
    try {
      seen.length = 0;
      await expect(
        resilient.extend(
          {
            orderId: ORDER.FLAKY,
            marketId: MARKET,
            additionalSeconds: 60,
            expectedExpiresAt: EXPECTED,
          },
          scope,
        ),
      ).resolves.toEqual({ kind: 'moved', expiresAt: EXPIRES_AT });
      expect(flakyExtends).toBe(2);
      // Iki denemede de AYNI beklenen bitis gider: tekrar hak harcamaz.
      expect(
        seen.map((entry) => (entry.request as { expectedExpiresAt?: Date }).expectedExpiresAt),
      ).toEqual([EXPECTED, EXPECTED]);

      await expect(
        resilient.shorten(
          { orderId: ORDER.FLAKY, marketId: MARKET, maxRemainingSeconds: 120 },
          scope,
        ),
      ).resolves.toEqual({ kind: 'active', expiresAt: EXPIRES_AT, changed: true });
      expect(flakyShortens).toBe(2);
    } finally {
      resilient.close();
    }
  });
});
