/**
 * Bellekteki rezervasyon kaydi (in-memory-reservation-store.ts): kayit tipleri ve
 * kaydin durumuna dair saf sorgular. Redis'te bunlar hash'in alanlari ve
 * TTL'idir (reservation-hash.ts, PEXPIRE).
 */

import type {
  InactiveReservation,
  ReservationLine,
  ReservationSettlement,
  SettledReservation,
} from '../../domain/reservation.js';

interface Settled {
  readonly settlement: ReservationSettlement;
  readonly reason: string;
  readonly at: number;
}

/**
 * Kaydin omurleri: depo ayarlarinin (InMemoryReservationStoreOptions) kayda dair
 * kismi. Redis'te hash'in PEXPIRE paylari.
 */
export interface RecordLifetimes {
  readonly holdAfterExpiryMs: number;
  readonly settledTtlMs: number;
}

export interface StoredReservation {
  readonly userId: string;
  readonly lines: readonly ReservationLine[];
  readonly expiresAt: number;
  /** Kac kez uzatildi (Redis'te hash'in `extended` alani, T11.3). */
  readonly extensionCount: number;
  /** Sonuclandiysa iz (Redis'te hash'in `state` alani). */
  readonly settled?: Settled;
}

export interface UserLock {
  readonly orderId: string;
  readonly expiresAt: number;
}

/** Uzatma ve kisaltma icin: aktif degilse sebebi, aktifse undefined (extend.lua sirasi). */
export function inactiveOf(
  options: RecordLifetimes,
  existing: StoredReservation | undefined,
  nowMs: number,
): InactiveReservation | undefined {
  if (existing?.settled !== undefined && isStored(options, existing, nowMs)) {
    return { status: 'inactive', reason: 'settled' };
  }
  if (existing === undefined || !isStored(options, existing, nowMs)) {
    return { status: 'inactive', reason: 'absent' };
  }
  if (existing.expiresAt <= nowMs) {
    return { status: 'inactive', reason: 'due' };
  }
  return undefined;
}

/** Iz varsa iz, kayit hic yoksa ya da dusmusse absent; aktif kayitta undefined. */
export function settledOrAbsent(
  options: RecordLifetimes,
  existing: StoredReservation | undefined,
  nowMs: number,
): SettledReservation | { readonly status: 'absent' } | undefined {
  if (existing === undefined || !isStored(options, existing, nowMs)) {
    return { status: 'absent' };
  }
  if (existing.settled !== undefined) {
    return {
      status: 'settled',
      settlement: existing.settled.settlement,
      reason: existing.settled.reason,
      settledAt: existing.settled.at,
      lines: sortedLines(existing.lines),
    };
  }
  return undefined;
}

/** Kayit hala duruyor mu (Redis'te hash'in TTL'i dolmadi mi)? */
export function isStored(
  options: RecordLifetimes,
  reservation: StoredReservation,
  nowMs: number,
): boolean {
  return reservation.settled === undefined
    ? nowMs < reservation.expiresAt + options.holdAfterExpiryMs
    : nowMs < reservation.settled.at + options.settledTtlMs;
}

export function memoryReservationKey(marketId: string, orderId: string): string {
  return `${marketId}/${orderId}`;
}

/** Redis uygulamasiyla ayni sira: SKU'ya gore. */
export function sortedLines(lines: readonly ReservationLine[]): ReservationLine[] {
  return [...lines].sort((left, right) => left.sku.localeCompare(right.sku));
}
