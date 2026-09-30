/**
 * Bellekteki rezervasyon (MOCK=true, B16): reserve.lua'nin AYNI kurallari,
 * Redis olmadan. Butun adimlar tek senkron blokta kosar: arada baska cagri
 * calisamaz, bu yuzden bellekte de kismi rezervasyon olmaz. Redis uygulamasi
 * ayni senaryolardan gecer (test/support/reservation-store-contract.ts).
 *
 * Sure dolumu: rezervasyon kaydi bitisten `holdAfterExpiryMs` sonrasina,
 * kullanici kilidi bitise kadar yasar (Redis'teki PEXPIRE ve PX ile ayni).
 * Suresi dolanin sayaclari geri vermek supurucunun isidir (T10.3).
 */

import { AppError } from '@getir/core';

import { duplicateSku } from '../../domain/reservation.js';
import type {
  ReservationLine,
  ReservationStore,
  ReserveCommand,
  ReserveOutcome,
} from '../../domain/reservation.js';

import { counterKey } from './in-memory-counter-key.js';

interface StoredReservation {
  readonly userId: string;
  readonly lines: readonly ReservationLine[];
  readonly expiresAt: number;
}

interface UserLock {
  readonly orderId: string;
  readonly expiresAt: number;
}

export interface InMemoryReservationStoreOptions {
  /** Kaydin bitisten sonra kalma payi (ms; Redis'te hash PEXPIRE payi). */
  readonly holdAfterExpiryMs: number;
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

  private reserveNow(command: ReserveCommand): ReserveOutcome {
    const { orderId, marketId, userId, lines, nowMs, ttlMs } = command;
    const reservationKey = `${marketId}/${orderId}`;

    // 0. Ayni siparis: sayaclar tekrar dusmez.
    const existing = this.reservations.get(reservationKey);
    if (existing !== undefined && nowMs < existing.expiresAt + this.options.holdAfterExpiryMs) {
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
      const key = counterKey(marketId, sku);
      this.counters.set(key, (this.counters.get(key) ?? 0) - quantity);
    }
    const expiresAt = nowMs + ttlMs;
    this.reservations.set(reservationKey, { userId, lines: [...lines], expiresAt });
    this.userLocks.set(userId, { orderId, expiresAt });
    return { status: 'reserved', expiresAt };
  }
}
