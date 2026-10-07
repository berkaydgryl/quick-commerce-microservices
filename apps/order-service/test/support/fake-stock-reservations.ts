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
 *
 * Uzatma ve kisaltma (T11.3, extend.lua / shorten.lua): bilinmeyen siparisin
 * kilidi "simdi + 10 dk" sayilir; kesin bitis gereken test `hold` ile kurar.
 * Uzatma hakki rezervasyon basina `maxExtensions` (inventory varsayilani 3).
 */

import { AppError, ERROR_CODES } from '@getir/core';

import { SETTLEMENT } from '../../src/application/stock-reservations.js';
import type {
  ExtendLockRequest,
  ExtendTiming,
  LockTiming,
  ReleaseStockRequest,
  ReserveStockOutcome,
  ReserveStockRequest,
  Settlement,
  SettleStockRequest,
  ShortenLockRequest,
  StockReservations,
} from '../../src/application/stock-reservations.js';

/** Testlerin kilit omru: 10 dk (RESERVATION_TTL_SECONDS varsayilani). */
export const FAKE_TTL_SECONDS = 600;

/** Testlerin kilit ayarlari (T11.3): ortamin varsayilanlari, orta risk 2 dk, uzatma 60 sn. */
export const TEST_LOCK_POLICY = { mediumRiskSeconds: 120, extendSeconds: 60 } as const;

interface Held {
  readonly userId: string;
  readonly lines: ReserveStockRequest['lines'];
  expiresAt: Date;
  extensions: number;
  state: 'held' | 'committed' | 'released';
}

export class FakeStockReservations implements StockReservations {
  readonly reserves: ReserveStockRequest[] = [];
  readonly commits: SettleStockRequest[] = [];
  readonly releases: ReleaseStockRequest[] = [];
  readonly extends: ExtendLockRequest[] = [];
  readonly shortens: ShortenLockRequest[] = [];
  /** Rezervasyon basina uzatma hakki (inventory RESERVATION_MAX_EXTENSIONS). */
  maxExtensions = 3;
  /** SKU -> satilabilir adet. Verilmeyen SKU 100 adet sayilir. */
  readonly available = new Map<string, number>();
  private readonly held = new Map<string, Held>();
  /** Suresi dolup birakilmis kilitler: Commit/Release NOT_FOUND alir. */
  private readonly gone = new Set<string>();
  /** Doluysa ilgili cagri bu hatayla basarisiz olur (orn. SERVICE_UNAVAILABLE). */
  reserveFailure: AppError | undefined;
  commitFailure: AppError | undefined;
  releaseFailure: AppError | undefined;
  extendFailure: AppError | undefined;
  shortenFailure: AppError | undefined;
  /** true: beklenen bitis denetimini bilmeyen eski inventory gibi davranir (T15.3). */
  ignoresExpectedExpiry = false;

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
      extensions: 0,
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

  extend(request: ExtendLockRequest): Promise<ExtendTiming> {
    this.extends.push(request);
    if (this.extendFailure !== undefined) {
      return Promise.reject(this.extendFailure);
    }
    const held = this.activeLock(request.orderId);
    if (held === undefined) {
      return Promise.resolve({ kind: 'lapsed' });
    }
    // Beklenen bitis (T15.3): inventory gibi aktiflikten sonra, hak sinirindan once.
    if (
      !this.ignoresExpectedExpiry &&
      request.expectedExpiresAt.getTime() !== held.expiresAt.getTime()
    ) {
      return Promise.resolve({ kind: 'moved', expiresAt: held.expiresAt });
    }
    if (held.extensions >= this.maxExtensions) {
      return Promise.resolve({ kind: 'active', expiresAt: held.expiresAt, changed: false });
    }
    held.expiresAt = new Date(held.expiresAt.getTime() + request.additionalSeconds * 1000);
    held.extensions += 1;
    return Promise.resolve({ kind: 'active', expiresAt: held.expiresAt, changed: true });
  }

  shorten(request: ShortenLockRequest): Promise<LockTiming> {
    this.shortens.push(request);
    if (this.shortenFailure !== undefined) {
      return Promise.reject(this.shortenFailure);
    }
    const held = this.activeLock(request.orderId);
    if (held === undefined) {
      return Promise.resolve({ kind: 'lapsed' });
    }
    const cap = this.now() + request.maxRemainingSeconds * 1000;
    if (held.expiresAt.getTime() <= cap) {
      return Promise.resolve({ kind: 'active', expiresAt: held.expiresAt, changed: false });
    }
    held.expiresAt = new Date(cap);
    return Promise.resolve({ kind: 'active', expiresAt: held.expiresAt, changed: true });
  }

  /** Testin on kosulu: siparisin kilidi inventory'de duruyor (taslak domain'den kuruldu). */
  hold(
    orderId: string,
    userId: string,
    lines: ReserveStockRequest['lines'],
    expiresAt: Date,
  ): void {
    this.held.set(orderId, { userId, lines, expiresAt, extensions: 0, state: 'held' });
  }

  /** Kilidin inventory'deki bitisi (uzatma/kisaltma sonrasi); bilinmiyorsa undefined. */
  expiryOf(orderId: string): Date | undefined {
    return this.held.get(orderId)?.expiresAt;
  }

  /** Kilit suresi dolup inventory supurucusu birakti: Commit NOT_FOUND alir. */
  expire(orderId: string): void {
    this.held.delete(orderId);
    this.gone.add(orderId);
  }

  /**
   * Kilidin bitisini siparisin HABERI OLMADAN degistirir (T15.3): cevabi
   * kaybolan bir uzatmayi ya da kaydedilmemis bir kisaltmayi canlandirir.
   */
  forceExpiry(orderId: string, expiresAt: Date): void {
    const held = this.held.get(orderId);
    if (held !== undefined) {
      held.expiresAt = expiresAt;
    }
  }

  extensionsOf(orderId: string): number | undefined {
    return this.held.get(orderId)?.extensions;
  }

  stateOf(orderId: string): Held['state'] | undefined {
    return this.held.get(orderId)?.state;
  }

  /**
   * Suresi ayarlanabilir kilit: sonuclanmamis ve bitisi gelmemis. Bilinmeyen
   * siparis (depoya dogrudan yazilmis taslak) "simdi + 10 dk" ile kilitli sayilir.
   */
  private activeLock(orderId: string): Held | undefined {
    if (this.gone.has(orderId)) {
      return undefined;
    }
    let held = this.held.get(orderId);
    if (held === undefined) {
      held = {
        userId: '',
        lines: [],
        expiresAt: new Date(this.now() + FAKE_TTL_SECONDS * 1000),
        extensions: 0,
        state: 'held',
      };
      this.held.set(orderId, held);
    }
    return held.state === 'held' && held.expiresAt.getTime() > this.now() ? held : undefined;
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
      this.held.set(orderId, {
        userId: '',
        lines: [],
        expiresAt: new Date(0),
        extensions: 0,
        state: to,
      });
      return SETTLEMENT.APPLIED;
    }
    if (held.state !== 'held') {
      // inventory gibi: ayni sonuc tekrar -> ALREADY_APPLIED; birakilmis kilit
      // onaylanamaz, onaylanmis kilit birakilamaz -> NOT_FOUND (commit-reservation.ts).
      return held.state === to ? SETTLEMENT.ALREADY_APPLIED : SETTLEMENT.NOT_FOUND;
    }
    held.state = to;
    return SETTLEMENT.APPLIED;
  }
}
