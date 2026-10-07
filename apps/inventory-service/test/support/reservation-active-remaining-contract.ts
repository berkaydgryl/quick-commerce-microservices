/**
 * Aktif kilidin kalan omru (T15.3; bekleyen is 126): 'user-has-active' sonucu
 * kullanicinin aktif kilidinin kalan omrunu tasir (Redis'te kullanici kilidinin
 * PTTL'i). Order kaydi olmayan (yetim) kilidin yasini bununla bulur; uzatma ve
 * kisaltmadan sonra da kilidin GUNCEL bitisini gostermeli. Bellek ve Redis ayni
 * sozlesmeden gecer (test/unit/reservation-store.spec.ts, test/integration/reservation.spec.ts).
 */

import { systemClock } from '@getir/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { MARKET, orderId, userId } from './reservation-store-contract.js';
import type { ReservationFixture } from './reservation-store-contract.js';

const TEN_MINUTES_MS = 600_000;
const ONE_MINUTE_MS = 60_000;
/** Cagrilar arasi gecen gercek sure icin pay (Redis PX gercek zamanlidir). */
const SLACK_MS = 5_000;

export function describeActiveRemainingContract(
  name: string,
  fresh: () => Promise<ReservationFixture>,
): void {
  describe(`aktif kilidin kalan omru (${name})`, () => {
    let stock: ReservationFixture;

    beforeEach(async () => {
      stock = await fresh();
      await stock.counters.write([{ marketId: MARKET, sku: 'SUT-1L', onHand: 5 }], 'overwrite');
    });

    const reserve = (order: number) =>
      stock.reservations.reserve({
        orderId: orderId(order),
        userId: userId(1),
        marketId: MARKET,
        lines: [{ sku: 'SUT-1L', quantity: 1 }],
        nowMs: systemClock.now(),
        ttlMs: TEN_MINUTES_MS,
      });

    /** Ayni kullanicinin ikinci sepetinin gordugu kalan omur. */
    const remainingSeenBySecondCart = async (): Promise<number> => {
      const outcome = await reserve(2);
      if (outcome.status !== 'user-has-active') {
        throw new Error(`beklenen user-has-active, gelen ${outcome.status}`);
      }
      expect(outcome.activeOrderId).toBe(orderId(1));
      return outcome.activeExpiresInMs;
    };

    it('yeni kilit: kalan omur kilit suresi kadar (gecen sure kadar eksik)', async () => {
      await reserve(1);

      const remaining = await remainingSeenBySecondCart();

      expect(remaining).toBeGreaterThan(TEN_MINUTES_MS - SLACK_MS);
      expect(remaining).toBeLessThanOrEqual(TEN_MINUTES_MS);
    });

    it('uzatmadan sonra: kalan omur uzatilmis bitise gore', async () => {
      await reserve(1);
      await stock.reservations.extend({
        orderId: orderId(1),
        marketId: MARKET,
        nowMs: systemClock.now(),
        additionalMs: ONE_MINUTE_MS,
        maxExtensions: 3,
      });

      const remaining = await remainingSeenBySecondCart();

      expect(remaining).toBeGreaterThan(TEN_MINUTES_MS + ONE_MINUTE_MS - SLACK_MS);
      expect(remaining).toBeLessThanOrEqual(TEN_MINUTES_MS + ONE_MINUTE_MS);
    });

    it('kisaltmadan sonra: kalan omur kisaltilmis bitise gore', async () => {
      await reserve(1);
      await stock.reservations.shorten({
        orderId: orderId(1),
        marketId: MARKET,
        nowMs: systemClock.now(),
        maxRemainingMs: 2 * ONE_MINUTE_MS,
      });

      const remaining = await remainingSeenBySecondCart();

      expect(remaining).toBeGreaterThan(2 * ONE_MINUTE_MS - SLACK_MS);
      expect(remaining).toBeLessThanOrEqual(2 * ONE_MINUTE_MS);
    });
  });
}
