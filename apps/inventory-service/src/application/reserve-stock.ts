/**
 * Use-case: sepetin tamamini tek atomik adimda rezerve eder (T10.1; ADR-01).
 *
 * Kurallar:
 *  - Ya butun kalemler ya hicbiri: yetmeyen ilk kalem STOCK_INSUFFICIENT
 *    (FAILED_PRECONDITION) doner, ayrintida sku, istenen ve mevcut adet
 *    (inventory.proto ReserveRequest). Hicbir sayac dusmemistir.
 *  - Sayaci olmayan SKU once Redis bosalmis mi diye sorulur (T10.1 PR 2,
 *    ADR-17): bosalmissa sayaclar yeniden kurulur ve rezervasyon BIR KEZ
 *    tekrarlanir. Gercekten sayaci yoksa yetersiz sayilir, mevcut 0 (bekleyen
 *    #36; 30 Eylul karari (a)): ayrintida `counterMissing` ve bir UYARI gunlugu.
 *  - Ayni siparis ikinci kez gelirse sayaclar tekrar dusmez: ilk bitis anini
 *    `alreadyReserved` ile dondurur (ADR-08'in stok tarafi).
 *  - Kullanicinin baska aktif rezervasyonu varsa RESERVATION_ACTIVE
 *    (ALREADY_EXISTS; B22, 30 Eylul karari (a)): ayrintida o siparisin kimligi.
 *    Eskisini birakip yenisini almak order'in karari (T11.2).
 *  - Negatif sayac (fazla satis izi) mevcut 0 olarak bildirilir ve UYARI
 *    yazilir: gizlenmez (CheckAvailability ile ayni kural).
 *  - Sureyi order verir (risk bandi); "simdi" servisin saatidir.
 */

import { AppError, ERROR_CODES } from '@getir/core';
import type { Clock, Logger } from '@getir/core';

import type { ReservationLine, ReservationStore } from '../domain/reservation.js';
import type { CounterRecovery } from '../domain/stock.js';

const MS_PER_SECOND = 1000;

export interface ReserveStockDeps {
  readonly reservations: ReservationStore;
  readonly recoverCounters: CounterRecovery;
  readonly clock: Clock;
  readonly logger: Logger;
}

export interface ReserveStockInput {
  readonly orderId: string;
  readonly marketId: string;
  readonly userId: string;
  /** Tekil SKU'lar (istek semasi dogrular). */
  readonly items: readonly ReservationLine[];
  readonly ttlSeconds: number;
}

export interface ReserveStockResult {
  readonly expiresAt: Date;
  /** true: bu siparis zaten rezerveydi, sayaclar tekrar dusmedi. */
  readonly alreadyReserved: boolean;
}

export type ReserveStock = (input: ReserveStockInput) => Promise<ReserveStockResult>;

export function createReserveStock(deps: ReserveStockDeps): ReserveStock {
  return async ({ orderId, marketId, userId, items, ttlSeconds }) => {
    const command = {
      orderId,
      marketId,
      userId,
      lines: items,
      nowMs: deps.clock.now(),
      ttlMs: ttlSeconds * MS_PER_SECOND,
    };
    let outcome = await deps.reservations.reserve(command);
    if (
      outcome.status === 'insufficient' &&
      outcome.counterMissing &&
      (await deps.recoverCounters())
    ) {
      outcome = await deps.reservations.reserve(command);
    }

    switch (outcome.status) {
      case 'reserved':
        return { expiresAt: new Date(outcome.expiresAt), alreadyReserved: false };
      case 'already-reserved':
        return { expiresAt: new Date(outcome.expiresAt), alreadyReserved: true };
      case 'user-has-active':
        throw new AppError(ERROR_CODES.RESERVATION_ACTIVE, 'Kullanicinin aktif rezervasyonu var', {
          details: { activeOrderId: outcome.activeOrderId },
        });
      case 'insufficient': {
        const { sku, requested, counter, counterMissing } = outcome;
        if (counterMissing) {
          deps.logger.warn({ marketId, sku, orderId }, 'rezervasyon: sayac yok, yetersiz sayildi');
        } else if (counter < 0) {
          deps.logger.warn({ marketId, sku, counter }, 'rezervasyon: stok sayaci negatif');
        }
        throw new AppError(ERROR_CODES.STOCK_INSUFFICIENT, 'Stok yetersiz', {
          details: {
            sku,
            requested,
            available: Math.max(0, counter),
            ...(counterMissing ? { counterMissing: true } : {}),
          },
        });
      }
    }
  };
}
