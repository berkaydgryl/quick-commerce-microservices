/**
 * Bellekteki rezervasyon (MOCK=true, B16): reserve.lua ve release.lua'nin AYNI
 * kurallari, Redis olmadan. Butun adimlar tek senkron blokta kosar: arada
 * baska cagri calisamaz, bu yuzden bellekte de kismi rezervasyon ya da cift
 * birakma olmaz. Redis uygulamasi ayni senaryolardan gecer
 * (test/support/reservation-store-contract.ts).
 *
 * Sure dolumu: rezervasyon kaydi bitisten `holdAfterExpiryMs` sonrasina,
 * kullanici kilidi bitise kadar yasar (Redis'teki PEXPIRE ve PX ile ayni).
 * Suresi dolanin sayaclari geri vermek supurucunun isidir (T10.3). Birakilan
 * kaydin izi `settledTtlMs` boyunca ya da forgetSettled'a kadar durur (ADR-18).
 */

import { AppError } from '@getir/core';

import { duplicateSku } from '../../domain/reservation.js';
import type {
  ReleaseCommand,
  ReleaseOutcome,
  ReservationLine,
  ReservationSettlement,
  ReservationStore,
  ReserveCommand,
  ReserveOutcome,
} from '../../domain/reservation.js';

import { counterKey } from './in-memory-counter-key.js';

interface Settled {
  readonly settlement: ReservationSettlement;
  readonly reason: string;
  readonly at: number;
}

interface StoredReservation {
  readonly userId: string;
  readonly lines: readonly ReservationLine[];
  readonly expiresAt: number;
  /** Sonuclandiysa iz (Redis'te hash'in `state` alani). */
  readonly settled?: Settled;
}

interface UserLock {
  readonly orderId: string;
  readonly expiresAt: number;
}

export interface InMemoryReservationStoreOptions {
  /** Kaydin bitisten sonra kalma payi (ms; Redis'te hash PEXPIRE payi). */
  readonly holdAfterExpiryMs: number;
  /** Sonuclanan kaydin izinin en uzun omru (ms; ADR-18). */
  readonly settledTtlMs: number;
}

export class InMemoryReservationStore implements ReservationStore {
  private readonly reservations = new Map<string, StoredReservation>();
  private readonly userLocks = new Map<string, UserLock>();

  /** @param counters Sayac deposuyla PAYLASILAN harita (in-memory-stock.ts). */
  constructor(
    private readonly counters: Map<string, number>,
    private readonly options: InMemoryReservationStoreOptions,
  ) {}

  reserve(command: ReserveCommand): Promise<ReserveOutcome> {
    const repeated = duplicateSku(command.lines);
    if (repeated !== undefined) {
      return Promise.reject(
        AppError.internal('rezervasyonda tekrar eden sku', { details: { sku: repeated } }),
      );
    }
    return Promise.resolve(this.reserveNow(command));
  }

  release(command: ReleaseCommand): Promise<ReleaseOutcome> {
    return Promise.resolve(this.releaseNow(command));
  }

  forgetSettled(marketId: string, orderId: string): Promise<void> {
    const key = reservationKey(marketId, orderId);
    if (this.reservations.get(key)?.settled !== undefined) {
      this.reservations.delete(key);
    }
    return Promise.resolve();
  }

  private reserveNow(command: ReserveCommand): ReserveOutcome {
    const { orderId, marketId, userId, lines, nowMs, ttlMs } = command;
    const key = reservationKey(marketId, orderId);

    // 0. Ayni siparis (ya da izi duran sonuclanmis kayit): sayaclar tekrar dusmez.
    const existing = this.reservations.get(key);
    if (existing !== undefined && this.isStored(existing, nowMs)) {
      return { status: 'already-reserved', expiresAt: existing.expiresAt };
    }

    // 1. Kullanicinin baska aktif rezervasyonu.
    const lock = this.userLocks.get(userId);
    if (lock !== undefined && nowMs < lock.expiresAt && lock.orderId !== orderId) {
      return { status: 'user-has-active', activeOrderId: lock.orderId };
    }

    // 2. Hepsini kontrol et, hicbir sey yazma.
    for (const { sku, quantity } of lines) {
      const counter = this.counters.get(counterKey(marketId, sku));
      if (counter === undefined) {
        return {
          status: 'insufficient',
          sku,
          requested: quantity,
          counter: 0,
          counterMissing: true,
        };
      }
      if (counter < quantity) {
        return { status: 'insufficient', sku, requested: quantity, counter, counterMissing: false };
      }
    }

    // 3-4. Hepsini birden dus; kaydi ve kullanici kilidini yaz.
    for (const { sku, quantity } of lines) {
      const counter = counterKey(marketId, sku);
      this.counters.set(counter, (this.counters.get(counter) ?? 0) - quantity);
    }
    const expiresAt = nowMs + ttlMs;
    this.reservations.set(key, { userId, lines: [...lines], expiresAt });
    this.userLocks.set(userId, { orderId, expiresAt });
    return { status: 'reserved', expiresAt };
  }

  private releaseNow(command: ReleaseCommand): ReleaseOutcome {
    const { orderId, marketId, reason, nowMs } = command;
    const key = reservationKey(marketId, orderId);
    const existing = this.reservations.get(key);

    // 0. Daha once sonuclanmis: iz oldugu gibi doner.
    if (existing?.settled !== undefined && this.isStored(existing, nowMs)) {
      return {
        status: 'settled',
        settlement: existing.settled.settlement,
        reason: existing.settled.reason,
        settledAt: existing.settled.at,
        lines: sortedLines(existing.lines),
      };
    }

    // 1. Aktif rezervasyon yok (hic olmamis ya da kaydi coktan dusmus).
    if (existing === undefined || !this.isStored(existing, nowMs)) {
      return { status: 'absent' };
    }

    // 2. Adetleri geri ekle; sayaci olmayan kalem atlanir (sayac yaratilmaz).
    let skippedCounters = 0;
    for (const { sku, quantity } of existing.lines) {
      const counter = counterKey(marketId, sku);
      const current = this.counters.get(counter);
      if (current === undefined) {
        skippedCounters += 1;
      } else {
        this.counters.set(counter, current + quantity);
      }
    }

    // 3. Kullanici kilidi yalnizca BU siparisinse silinir; kayit iz olarak kalir.
    if (this.userLocks.get(existing.userId)?.orderId === orderId) {
      this.userLocks.delete(existing.userId);
    }
    this.reservations.set(key, {
      ...existing,
      settled: { settlement: 'released', reason, at: nowMs },
    });
    return { status: 'released', skippedCounters, lines: sortedLines(existing.lines) };
  }

  /** Kayit hala duruyor mu (Redis'te hash'in TTL'i dolmadi mi)? */
  private isStored(reservation: StoredReservation, nowMs: number): boolean {
    return reservation.settled === undefined
      ? nowMs < reservation.expiresAt + this.options.holdAfterExpiryMs
      : nowMs < reservation.settled.at + this.options.settledTtlMs;
  }
}

function reservationKey(marketId: string, orderId: string): string {
  return `${marketId}/${orderId}`;
}

/** Redis uygulamasiyla ayni sira: SKU'ya gore. */
function sortedLines(lines: readonly ReservationLine[]): ReservationLine[] {
  return [...lines].sort((left, right) => left.sku.localeCompare(right.sku));
}
