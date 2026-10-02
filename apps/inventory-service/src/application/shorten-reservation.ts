/**
 * Use-case: rezervasyonun kalan suresini kisaltir (T11.3; roadmap "Bantlar ve
 * aksiyonlar": orta risk bandinda kilit 2 dk). Kilit taslak acilirken uzun
 * sureyle alinir (T11.2); risk odeme adiminda sorulur ve orta bantta order
 * kalan sureyi indirir.
 *
 * Sonuclar:
 *  - kisaltildi: yeni bitis (simdi + sinir).
 *  - degismedi: kalan sure zaten sinirin altindaydi; sure ASLA uzatilmaz.
 *  - aktif rezervasyon yok: RESERVATION_EXPIRED (uzatmayla ayni kural).
 *
 * Stok defterine yazilmaz: stok hareket etmedi, karar order'in kaydinda
 * (risk bandi) durur.
 */

import type { Clock, Logger } from '@getir/core';

import { MS_PER_SECOND } from '../config/constants.js';
import type { ReservationStore } from '../domain/reservation.js';
import { reservationNotActive } from './inactive-reservation.js';

export interface ShortenReservationDeps {
  readonly reservations: Pick<ReservationStore, 'shorten'>;
  readonly clock: Clock;
  readonly logger: Logger;
}

export interface ShortenReservationInput {
  readonly orderId: string;
  readonly marketId: string;
  readonly maxRemainingSeconds: number;
}

export interface ShortenReservationResult {
  readonly expiresAt: Date;
  /** false: kalan sure zaten sinirin altindaydi. */
  readonly shortened: boolean;
}

export type ShortenReservation = (
  input: ShortenReservationInput,
) => Promise<ShortenReservationResult>;

export function createShortenReservation(deps: ShortenReservationDeps): ShortenReservation {
  return async (input) => {
    const { orderId, marketId, maxRemainingSeconds } = input;
    const outcome = await deps.reservations.shorten({
      orderId,
      marketId,
      nowMs: deps.clock.now(),
      maxRemainingMs: maxRemainingSeconds * MS_PER_SECOND,
    });

    switch (outcome.status) {
      case 'shortened':
        deps.logger.info(
          { orderId, marketId, expiresAt: new Date(outcome.expiresAt), maxRemainingSeconds },
          'rezervasyon kisaltildi',
        );
        return { expiresAt: new Date(outcome.expiresAt), shortened: true };
      case 'unchanged':
        return { expiresAt: new Date(outcome.expiresAt), shortened: false };
      case 'inactive':
        throw reservationNotActive(input, outcome);
    }
  };
}
