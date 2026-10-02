/**
 * StockReservations portunun gRPC uygulamasi: order -> inventory (T11.2; uzatma
 * ve kisaltma T11.3).
 *
 * Tasima isi service-kit callUnary'dedir (requestId, sure siniri, hata cevirisi:
 * inventory'nin x-app-error'u kodu ve ayrintisiyla AppError olur). Burasi
 * domain <-> proto cevirisini ve BEKLENEN sonuclarin ayrimini yapar: stok
 * yetmedi, kullanicinin aktif kilidi ve kilidin dusmesi saga'nin karar verecegi
 * sonuclardir, hata olarak yukari cikmaz.
 */

import { AppError, ERROR_CODES, isAppError } from '@getir/core';
import { inventoryV1 } from '@getir/proto';
import { callUnary } from '@getir/service-kit';
import type { OutgoingCallOptions } from '@getir/service-kit';
import { credentials } from '@grpc/grpc-js';
import { z } from 'zod';

import type { RequestScope } from '../../application/request-scope.js';
import { SETTLEMENT } from '../../application/stock-reservations.js';
import { IDEMPOTENT, NOT_IDEMPOTENT, outgoingOptions } from '../grpc-resilience.js';
import type { ClientResilience } from '../grpc-resilience.js';
import type {
  ExtendLockRequest,
  LockTiming,
  ReleaseStockRequest,
  ReserveStockOutcome,
  ReserveStockRequest,
  Settlement,
  SettleStockRequest,
  ShortenLockRequest,
  StockReservations,
} from '../../application/stock-reservations.js';

/**
 * Proto sonucu -> port sonucu. UNSPECIFIED/UNRECOGNIZED bilerek yok: anlami
 * bilinmeyen cevapla stok hareketi varsayilmaz.
 */
const SETTLEMENT_FROM_PROTO: Readonly<
  Record<inventoryV1.ReservationOutcome, Settlement | undefined>
> = {
  [inventoryV1.ReservationOutcome.RESERVATION_OUTCOME_UNSPECIFIED]: undefined,
  [inventoryV1.ReservationOutcome.RESERVATION_OUTCOME_APPLIED]: SETTLEMENT.APPLIED,
  [inventoryV1.ReservationOutcome.RESERVATION_OUTCOME_ALREADY_APPLIED]: SETTLEMENT.ALREADY_APPLIED,
  [inventoryV1.ReservationOutcome.RESERVATION_OUTCOME_NOT_FOUND]: SETTLEMENT.NOT_FOUND,
  [inventoryV1.ReservationOutcome.UNRECOGNIZED]: undefined,
};

/** RESERVATION_ACTIVE ayrintisi DIS VERIDIR: kimlik dogrulanmadan kullanilmaz. */
const activeReservationDetails = z.object({ activeOrderId: z.string().startsWith('ord_') });

export class GrpcStockReservations implements StockReservations {
  private readonly client: inventoryV1.InventoryServiceClient;

  constructor(
    address: string,
    private readonly timeoutMs: number,
    private readonly resilience: ClientResilience = {},
  ) {
    // TLS YOK: servisler yalnizca ic agda konusur (diger istemcilerle ayni karar).
    this.client = new inventoryV1.InventoryServiceClient(address, credentials.createInsecure());
  }

  async reserve(request: ReserveStockRequest, scope: RequestScope): Promise<ReserveStockOutcome> {
    let response: inventoryV1.ReserveResponse;
    try {
      response = await callUnary<inventoryV1.ReserveRequest, inventoryV1.ReserveResponse>(
        (message, metadata, options, callback) =>
          this.client.reserve(message, metadata, options, callback),
        inventoryV1.ReserveRequest.fromPartial({
          orderId: request.orderId,
          userId: request.userId,
          marketId: request.marketId,
          items: request.lines.map((line) => ({ sku: line.sku, quantity: line.quantity })),
          ttlSeconds: request.ttlSeconds,
        }),
        this.options(scope, IDEMPOTENT),
      );
    } catch (error: unknown) {
      return expectedReserveOutcome(error);
    }
    if (response.expiresAt === undefined) {
      throw AppError.internal('Stok servisi rezervasyon bitis anini dondurmedi', {
        details: { orderId: request.orderId },
      });
    }
    return { kind: 'reserved', expiresAt: response.expiresAt };
  }

  async commit(request: SettleStockRequest, scope: RequestScope): Promise<Settlement> {
    const response = await callUnary<inventoryV1.CommitRequest, inventoryV1.CommitResponse>(
      (message, metadata, options, callback) =>
        this.client.commit(message, metadata, options, callback),
      inventoryV1.CommitRequest.fromPartial({
        orderId: request.orderId,
        marketId: request.marketId,
      }),
      this.options(scope, IDEMPOTENT),
    );
    return settlementOf(response.outcome, request.orderId);
  }

  async release(request: ReleaseStockRequest, scope: RequestScope): Promise<Settlement> {
    const response = await callUnary<inventoryV1.ReleaseRequest, inventoryV1.ReleaseResponse>(
      (message, metadata, options, callback) =>
        this.client.release(message, metadata, options, callback),
      inventoryV1.ReleaseRequest.fromPartial({
        orderId: request.orderId,
        marketId: request.marketId,
        reason: request.reason,
      }),
      this.options(scope, IDEMPOTENT),
    );
    return settlementOf(response.outcome, request.orderId);
  }

  /**
   * Uzatma (T11.3). Tekrar guvenli DEGIL: her cagri bir uzatma hakki harcar,
   * cevabi kaybolan istegi yeniden denemek hakki bosa yakardi (D17).
   */
  async extend(request: ExtendLockRequest, scope: RequestScope): Promise<LockTiming> {
    let response: inventoryV1.ExtendReservationResponse;
    try {
      response = await callUnary<
        inventoryV1.ExtendReservationRequest,
        inventoryV1.ExtendReservationResponse
      >(
        (message, metadata, options, callback) =>
          this.client.extendReservation(message, metadata, options, callback),
        inventoryV1.ExtendReservationRequest.fromPartial({
          orderId: request.orderId,
          marketId: request.marketId,
          additionalSeconds: request.additionalSeconds,
        }),
        this.options(scope, NOT_IDEMPOTENT),
      );
    } catch (error: unknown) {
      return lapsedOrThrow(error);
    }
    return activeTiming(response.expiresAt, !response.alreadyExtended, request.orderId);
  }

  /** Kisaltma (T11.3): ayni sinira tekrar inmek zararsiz, yeniden denenebilir. */
  async shorten(request: ShortenLockRequest, scope: RequestScope): Promise<LockTiming> {
    let response: inventoryV1.ShortenReservationResponse;
    try {
      response = await callUnary<
        inventoryV1.ShortenReservationRequest,
        inventoryV1.ShortenReservationResponse
      >(
        (message, metadata, options, callback) =>
          this.client.shortenReservation(message, metadata, options, callback),
        inventoryV1.ShortenReservationRequest.fromPartial({
          orderId: request.orderId,
          marketId: request.marketId,
          maxRemainingSeconds: request.maxRemainingSeconds,
        }),
        this.options(scope, IDEMPOTENT),
      );
    } catch (error: unknown) {
      return lapsedOrThrow(error);
    }
    return activeTiming(response.expiresAt, response.shortened, request.orderId);
  }

  /** Kapanista cagrilir: acik HTTP/2 baglantisi process'i ayakta tutmasin. */
  close(): void {
    this.client.close();
  }

  /** Reserve, Commit, Release ve kisaltma tekrar guvenli; uzatma degil (D17). */
  private options(scope: RequestScope, idempotent: boolean): OutgoingCallOptions {
    return outgoingOptions(scope, this.timeoutMs, this.resilience, idempotent);
  }
}

/**
 * Stok yetmedi ve kullanicinin aktif kilidi sonuc olarak doner; gerisi (kapali
 * servis, gecersiz istek) hata olarak yukari gider.
 */
function expectedReserveOutcome(error: unknown): ReserveStockOutcome {
  if (isAppError(error) && error.code === ERROR_CODES.STOCK_INSUFFICIENT) {
    return { kind: 'insufficient', error };
  }
  if (isAppError(error) && error.code === ERROR_CODES.RESERVATION_ACTIVE) {
    const details = activeReservationDetails.safeParse(error.details);
    if (details.success) {
      return { kind: 'user-has-active', activeOrderId: details.data.activeOrderId, error };
    }
  }
  throw error;
}

/** Kilidin dusmesi (RESERVATION_EXPIRED) sonuctur; gerisi hata olarak yukari gider. */
function lapsedOrThrow(error: unknown): LockTiming {
  if (isAppError(error) && error.code === ERROR_CODES.RESERVATION_EXPIRED) {
    return { kind: 'lapsed' };
  }
  throw error;
}

/** Bitis anisiz cevapla kilit suresi varsayilmaz: INTERNAL. */
function activeTiming(expiresAt: Date | undefined, changed: boolean, orderId: string): LockTiming {
  if (expiresAt === undefined) {
    throw AppError.internal('Stok servisi kilidin bitis anini dondurmedi', {
      details: { orderId },
    });
  }
  return { kind: 'active', expiresAt, changed };
}

function settlementOf(outcome: inventoryV1.ReservationOutcome, orderId: string): Settlement {
  const settlement = SETTLEMENT_FROM_PROTO[outcome];
  if (settlement === undefined) {
    throw AppError.internal('Stok servisi bilinmeyen sonuc dondurdu', {
      details: { orderId, outcome },
    });
  }
  return settlement;
}
