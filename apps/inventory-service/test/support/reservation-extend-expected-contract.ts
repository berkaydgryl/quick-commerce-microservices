/**
 * Uzatmada beklenen bitis sozlesmesi (T15.3; bekleyen is 117, QA IQ3): bellek
 * ve Redis (extend.lua) uygulamalari AYNI senaryolardan gecer. Cevabi kaybolan
 * uzatmanin tekrari hakki ikinci kez yakmamali; bitis tutmazsa sureye
 * dokunulmaz, guncel hal doner. Sira: aktiflik, beklenen bitis, hak siniri.
 *
 * Ana sozlesme (reservation-store-contract.ts) 600 satira yakin oldugu icin
 * ayri dosyadadir; fikstur bicimi ayni.
 */

import { systemClock } from '@getir/core';
import { beforeEach, describe, expect, it } from 'vitest';

import type { StockLevel } from '../../src/domain/stock.js';
import { MARKET, orderId, userId } from './reservation-store-contract.js';
import type { ReservationFixture } from './reservation-store-contract.js';

const LEVELS: readonly StockLevel[] = [
  { marketId: MARKET, sku: 'SUT-1L', onHand: 5 },
  { marketId: MARKET, sku: 'KOLA-1L', onHand: 3 },
];

const TEN_MINUTES_MS = 600_000;
const ONE_MINUTE_MS = 60_000;

/** fresh: her testten once BOS depo (Redis'te FLUSHALL). */
export function describeExtendExpectedContract(
  name: string,
  fresh: () => Promise<ReservationFixture>,
): void {
  describe(`uzatmada beklenen bitis (${name})`, () => {
    let stock: ReservationFixture;
    let nowMs: number;
    let reservedUntil: number;

    beforeEach(async () => {
      stock = await fresh();
      await stock.counters.write(LEVELS, 'overwrite');
      nowMs = systemClock.now();
      reservedUntil = nowMs + TEN_MINUTES_MS;
      await stock.reservations.reserve({
        orderId: orderId(1),
        userId: userId(1),
        marketId: MARKET,
        lines: [
          { sku: 'SUT-1L', quantity: 2 },
          { sku: 'KOLA-1L', quantity: 1 },
        ],
        nowMs,
        ttlMs: TEN_MINUTES_MS,
      });
    });

    const extend = (expectedExpiresAt?: number, maxExtensions = 3) =>
      stock.reservations.extend({
        orderId: orderId(1),
        marketId: MARKET,
        nowMs,
        additionalMs: ONE_MINUTE_MS,
        maxExtensions,
        ...(expectedExpiresAt === undefined ? {} : { expectedExpiresAt }),
      });

    const LINES = [
      { sku: 'KOLA-1L', quantity: 1 },
      { sku: 'SUT-1L', quantity: 2 },
    ];

    it('beklenen bitis tutuyorsa uzatir (hak harcar)', async () => {
      expect(await extend(reservedUntil)).toEqual({
        status: 'extended',
        expiresAt: reservedUntil + ONE_MINUTE_MS,
        extensionCount: 1,
        lines: LINES,
      });
    });

    it('cevabi kaybolan uzatmanin tekrari hakki YAKMAZ: guncel hal ve kalemler doner', async () => {
      await extend(reservedUntil);

      expect(await extend(reservedUntil)).toEqual({
        status: 'expiry-mismatch',
        expiresAt: reservedUntil + ONE_MINUTE_MS,
        extensionCount: 1,
        lines: LINES,
      });
      // Hak bir kez harcandi: guncel bitisle gelen sonraki uzatma sayaci 2 yapar.
      expect(await extend(reservedUntil + ONE_MINUTE_MS)).toMatchObject({
        status: 'extended',
        expiresAt: reservedUntil + 2 * ONE_MINUTE_MS,
        extensionCount: 2,
      });
    });

    it('kisaltilmis kilitte eski beklenen bitis uyusmaz; sureye dokunulmaz', async () => {
      await stock.reservations.shorten({
        orderId: orderId(1),
        marketId: MARKET,
        nowMs,
        maxRemainingMs: 2 * ONE_MINUTE_MS,
      });

      expect(await extend(reservedUntil)).toMatchObject({
        status: 'expiry-mismatch',
        expiresAt: nowMs + 2 * ONE_MINUTE_MS,
        extensionCount: 0,
      });
      expect(await extend(nowMs + 2 * ONE_MINUTE_MS)).toMatchObject({
        status: 'extended',
        expiresAt: nowMs + 3 * ONE_MINUTE_MS,
      });
    });

    it('ayni beklenen bitisle 5 es zamanli uzatma: tam biri uzatir, hak bir kez harcanir', async () => {
      const outcomes = await Promise.all(Array.from({ length: 5 }, () => extend(reservedUntil)));

      expect(outcomes.filter((outcome) => outcome.status === 'extended')).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.status === 'expiry-mismatch')).toHaveLength(4);
      expect(await extend(reservedUntil + ONE_MINUTE_MS)).toMatchObject({ extensionCount: 2 });
    });

    it('beklenen bitis verilmezse eski davranis: her cagri bir hak harcar', async () => {
      await extend();

      expect(await extend()).toMatchObject({ status: 'extended', extensionCount: 2 });
    });

    it('sira: aktiflik once (sonuclanmis kilit, beklenen bitis tutmasa da inactive)', async () => {
      await stock.reservations.commit({ orderId: orderId(1), marketId: MARKET, nowMs });

      expect(await extend(reservedUntil + 1)).toEqual({ status: 'inactive', reason: 'settled' });
    });

    it('sira: bitis ani gecmis kilitte beklenen bitis tutsa da due (dusmus kilit diriltilmez)', async () => {
      const late = stock.reservations.extend({
        orderId: orderId(1),
        marketId: MARKET,
        nowMs: reservedUntil,
        additionalMs: ONE_MINUTE_MS,
        maxExtensions: 3,
        expectedExpiresAt: reservedUntil,
      });

      expect(await late).toEqual({ status: 'inactive', reason: 'due' });
    });

    it('sira: beklenen bitis hak sinirindan once; hak bitmisken tutan beklenen limit-reached', async () => {
      await extend(reservedUntil, 1);
      const extendedUntil = reservedUntil + ONE_MINUTE_MS;

      expect(await extend(reservedUntil, 1)).toMatchObject({
        status: 'expiry-mismatch',
        expiresAt: extendedUntil,
        extensionCount: 1,
      });
      expect(await extend(extendedUntil, 1)).toEqual({
        status: 'limit-reached',
        expiresAt: extendedUntil,
        extensionCount: 1,
      });
    });
  });
}
