/**
 * Sahte inventory (T11.2): stok kilidinin kurallari inventory'deki gibi
 * (reserve.lua, commit.lua, release.lua) ama bellekte ve basitlestirilmis:
 *   - adet: SKU basina sayac; yetmeyen ilk kalem STOCK_INSUFFICIENT;
 *   - kullanici basina tek aktif kilit (B22): RESERVATION_ACTIVE + activeOrderId;
 *   - ayni siparis ikinci kez kilitlenmez (idempotent), Commit/Release bir kez.
 * Cagrilar kaydedilir; hata ve "kilit dustu" senaryolari disaridan ayarlanir.
 *
 * Testler taslagi cogu zaman depoya DOGRUDAN yazar (insertDraft, kilitli taslak):
 * sahte, bilmedigi siparisi KILITLI sayar. "Kilit dustu" acikca `expire` ile kurulur.
 */

import { AppError, ERROR_CODES } from '@getir/core';

import { SETTLEMENT } from '../../src/application/stock-reservations.js';
import type {
  ReleaseStockRequest,
  ReserveStockOutcome,
  ReserveStockRequest,
  Settlement,
  SettleStockRequest,
  StockReservations,
} from '../../src/application/stock-reservations.js';

/** Testlerin kilit omru: 10 dk (RESERVATION_TTL_SECONDS varsayilani). */
export const FAKE_TTL_SECONDS = 600;

interface Held {
  readonly userId: string;
  readonly lines: ReserveStockRequest['lines'];
  readonly expiresAt: Date;
  state: 'held' | 'committed' | 'released';
}

export class FakeStockReservations implements StockReservations {
  readonly reserves: ReserveStockRequest[] = [];
  readonly commits: SettleStockRequest[] = [];
  readonly releases: ReleaseStockRequest[] = [];
  /** SKU -> satilabilir adet. Verilmeyen SKU 100 adet sayilir. */
  readonly available = new Map<string, number>();
  private readonly held = new Map<string, Held>();
  /** Suresi dolup birakilmis kilitler: Commit/Release NOT_FOUND alir. */
  private readonly gone = new Set<string>();
  /** Doluysa ilgili cagri bu hatayla basarisiz olur (orn. SERVICE_UNAVAILABLE). */
  reserveFailure: AppError | undefined;
  commitFailure: AppError | undefined;
  releaseFailure: AppError | undefined;

  constructor(private readonly now: () => number = () => Date.now()) {}

  reserve(request: ReserveStockRequest): Promise<ReserveStockOutcome> {
    this.reserves.push(request);
    if (this.reserveFailure !== undefined) {
      return Promise.reject(this.reserveFailure);
    }
    const existing = this.held.get(request.orderId);
    if (existing !== undefined && existing.state === 'held') {
      return Promise.resolve({ kind: 'reserved', expiresAt: existing.expiresAt });
    }
    const active = [...this.held.entries()].find(
      ([, held]) => held.userId === request.userId && held.state === 'held',
    );
    if (active !== undefined) {
      const error = new AppError(
        ERROR_CODES.RESERVATION_ACTIVE,
        'Kullanicinin aktif rezervasyonu var',
        {
          details: { activeOrderId: active[0] },
        },
      );
      return Promise.resolve({ kind: 'user-has-active', activeOrderId: active[0], error });
    }
    for (const line of request.lines) {
      const have = this.stockOf(line.sku);
      if (have < line.quantity) {
        const error = new AppError(ERROR_CODES.STOCK_INSUFFICIENT, 'Stok yetersiz', {
          details: { sku: line.sku, requested: line.quantity, available: have },
        });
        return Promise.resolve({ kind: 'insufficient', error });
      }
    }
    for (const line of request.lines) {
      this.available.set(line.sku, this.stockOf(line.sku) - line.quantity);
    }
    const expiresAt = new Date(this.now() + request.ttlSeconds * 1000);
    this.held.set(request.orderId, {
      userId: request.userId,
      lines: request.lines,
      expiresAt,
      state: 'held',
    });
    return Promise.resolve({ kind: 'reserved', expiresAt });
  }

  commit(request: SettleStockRequest): Promise<Settlement> {
    this.commits.push(request);
    if (this.commitFailure !== undefined) {
      return Promise.reject(this.commitFailure);
    }
    return Promise.resolve(this.settle(request.orderId, 'committed'));
  }

  release(request: ReleaseStockRequest): Promise<Settlement> {
    this.releases.push(request);
    if (this.releaseFailure !== undefined) {
      return Promise.reject(this.releaseFailure);
    }
    const held = this.held.get(request.orderId);
    const outcome = this.settle(request.orderId, 'released');
    if (outcome === SETTLEMENT.APPLIED && held !== undefined) {
      for (const line of held.lines) {
        this.available.set(line.sku, this.stockOf(line.sku) + line.quantity);
      }
    }
    return Promise.resolve(outcome);
  }

  /** Testin on kosulu: siparisin kilidi inventory'de duruyor (taslak domain'den kuruldu). */
  hold(
    orderId: string,
    userId: string,
    lines: ReserveStockRequest['lines'],
    expiresAt: Date,
  ): void {
    this.held.set(orderId, { userId, lines, expiresAt, state: 'held' });
  }

  /** Kilit suresi dolup inventory supurucusu birakti: Commit NOT_FOUND alir. */
  expire(orderId: string): void {
    this.held.delete(orderId);
    this.gone.add(orderId);
  }

  stateOf(orderId: string): Held['state'] | undefined {
    return this.held.get(orderId)?.state;
  }

  private stockOf(sku: string): number {
    return this.available.get(sku) ?? 100;
  }

  private settle(orderId: string, to: 'committed' | 'released'): Settlement {
    if (this.gone.has(orderId)) {
      return SETTLEMENT.NOT_FOUND;
    }
    const held = this.held.get(orderId);
    if (held === undefined) {
      // Depoya dogrudan yazilmis kilitli taslak: kilit inventory'de var sayilir.
      this.held.set(orderId, { userId: '', lines: [], expiresAt: new Date(0), state: to });
      return SETTLEMENT.APPLIED;
    }
    if (held.state !== 'held') {
      return SETTLEMENT.ALREADY_APPLIED;
    }
    held.state = to;
    return SETTLEMENT.APPLIED;
  }
}
