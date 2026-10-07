/**
 * Rezervasyon sozlesmesi (T10.1; birakma ve onay T10.2; sure dolumu T10.3;
 * uzatma ve kisaltma T11.3): bellek (MOCK) ve Redis (reserve.lua, release.lua,
 * commit.lua, extend.lua, shorten.lua) uygulamalari AYNI senaryolardan gecer.
 * Bellekteki birim testinde, Redis entegrasyon testinde kosar.
 *
 * Saat GERCEKTIR: Redis'te kullanici kilidi ve kayit gercek sureyle (PX,
 * PEXPIRE) doldugu icin sure senaryolari kisa sure + gercek bekleme kullanir.
 */

import { AppError, ERROR_CODES, systemClock } from '@getir/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { RESERVATION_HOLD_AFTER_EXPIRY_MS } from '../../src/config/constants.js';
import type { ReservationLine, ReservationStore } from '../../src/domain/reservation.js';
import type { StockCounterReader, StockCounterWriter, StockLevel } from '../../src/domain/stock.js';

export interface ReservationFixture {
  readonly counters: StockCounterReader & StockCounterWriter;
  readonly reservations: ReservationStore;
}

export const MARKET = 'mkt_migros-jet-moda';
export const OTHER_MARKET = 'mkt_a101-caferaga';

const LEVELS: readonly StockLevel[] = [
  { marketId: MARKET, sku: 'SUT-1L', onHand: 5 },
  { marketId: MARKET, sku: 'KOLA-1L', onHand: 3 },
  { marketId: MARKET, sku: 'CIPS-150', onHand: 2 },
  { marketId: MARKET, sku: 'CIKOLATA-80', onHand: 1 },
  { marketId: OTHER_MARKET, sku: 'SUT-1L', onHand: 4 },
];

/** Uretilen kimlik bicimi (ID_PREFIX + 32 hex); sira numarasindan. */
export const orderId = (n: number): string => `ord_${n.toString(16).padStart(32, '0')}`;
export const userId = (n: number): string => `usr_${n.toString(16).padStart(32, '0')}`;

const TEN_MINUTES_MS = 600_000;
/** Kilidin dolumunu beklemek icin kisa sure (Redis PX gercek zamanlidir). */
const SHORT_TTL_MS = 200;
/** Kisa surenin dolmasi icin beklenen: kayit payi (60 sn) icinde kalir. */
const AFTER_SHORT_TTL_MS = SHORT_TTL_MS + 100;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** fresh: her testten once BOS depo (Redis'te FLUSHALL). */
export function describeReservationStoreContract(
  name: string,
  fresh: () => Promise<ReservationFixture>,
): void {
  describe(`rezervasyon sozlesmesi (${name})`, () => {
    let stock: ReservationFixture;

    beforeEach(async () => {
      stock = await fresh();
      await stock.counters.write(LEVELS, 'overwrite');
    });

    const counts = async (marketId: string, skus: readonly string[]) =>
      Object.fromEntries(await stock.counters.available(marketId, skus));

    const reserve = (
      order: number,
      user: number,
      lines: readonly ReservationLine[],
      options: { marketId?: string; ttlMs?: number; nowMs?: number } = {},
    ) =>
      stock.reservations.reserve({
        orderId: orderId(order),
        userId: userId(user),
        marketId: options.marketId ?? MARKET,
        lines,
        nowMs: options.nowMs ?? systemClock.now(),
        ttlMs: options.ttlMs ?? TEN_MINUTES_MS,
      });

    it('butun kalemler rezerve edilir, sayaclar duser; bitis = simdi + sure', async () => {
      const nowMs = systemClock.now();

      const outcome = await reserve(
        1,
        1,
        [
          { sku: 'SUT-1L', quantity: 2 },
          { sku: 'KOLA-1L', quantity: 1 },
        ],
        { nowMs },
      );

      expect(outcome).toEqual({ status: 'reserved', expiresAt: nowMs + TEN_MINUTES_MS });
      expect(await counts(MARKET, ['SUT-1L', 'KOLA-1L'])).toEqual({ 'SUT-1L': 3, 'KOLA-1L': 2 });
    });

    it('KISMI REZERVASYON YOK: ucuncu kalem yetmezse hicbir sayac dusmez', async () => {
      const outcome = await reserve(1, 1, [
        { sku: 'SUT-1L', quantity: 1 },
        { sku: 'KOLA-1L', quantity: 1 },
        { sku: 'CIPS-150', quantity: 9 },
      ]);

      expect(outcome).toEqual({
        status: 'insufficient',
        sku: 'CIPS-150',
        requested: 9,
        counter: 2,
        counterMissing: false,
      });
      expect(await counts(MARKET, ['SUT-1L', 'KOLA-1L', 'CIPS-150'])).toEqual({
        'SUT-1L': 5,
        'KOLA-1L': 3,
        'CIPS-150': 2,
      });
    });

    it('basarisiz denemeden sonra kullanici kilidi kalmaz: ayni kullanici hemen rezerve eder', async () => {
      await reserve(1, 1, [{ sku: 'CIPS-150', quantity: 9 }]);

      expect((await reserve(2, 1, [{ sku: 'CIPS-150', quantity: 2 }])).status).toBe('reserved');
    });

    it('sayaci olmayan SKU yetersiz sayilir (counterMissing, #36); hicbir sey yazilmaz', async () => {
      const outcome = await reserve(1, 1, [
        { sku: 'SUT-1L', quantity: 1 },
        { sku: 'YOK-1', quantity: 1 },
      ]);

      expect(outcome).toEqual({
        status: 'insufficient',
        sku: 'YOK-1',
        requested: 1,
        counter: 0,
        counterMissing: true,
      });
      expect(await counts(MARKET, ['SUT-1L'])).toEqual({ 'SUT-1L': 5 });
    });

    it('ayni siparis ikinci kez: sayaclar TEKRAR dusmez, ilk bitis doner (ADR-08)', async () => {
      const first = await reserve(1, 1, [{ sku: 'SUT-1L', quantity: 2 }]);
      const second = await reserve(1, 1, [{ sku: 'SUT-1L', quantity: 2 }], {
        nowMs: systemClock.now() + 5_000,
      });

      expect(first.status).toBe('reserved');
      expect(second).toEqual({
        status: 'already-reserved',
        expiresAt: first.status === 'reserved' ? first.expiresAt : -1,
      });
      expect(await counts(MARKET, ['SUT-1L'])).toEqual({ 'SUT-1L': 3 });
    });

    it('kullanicinin baska aktif rezervasyonu varsa yenisi acilmaz (B22); sayaclar degismez', async () => {
      await reserve(1, 1, [{ sku: 'SUT-1L', quantity: 1 }]);

      const outcome = await reserve(2, 1, [{ sku: 'KOLA-1L', quantity: 1 }]);

      expect(outcome).toMatchObject({ status: 'user-has-active', activeOrderId: orderId(1) });
      expect(await counts(MARKET, ['SUT-1L', 'KOLA-1L'])).toEqual({ 'SUT-1L': 4, 'KOLA-1L': 3 });
      // Baska kullanici etkilenmez.
      expect((await reserve(3, 2, [{ sku: 'KOLA-1L', quantity: 1 }])).status).toBe('reserved');
    });

    it('kullanici kilidi rezervasyonun suresi kadar yasar; dolunca yeni siparis acilir', async () => {
      await reserve(1, 1, [{ sku: 'SUT-1L', quantity: 1 }], { ttlMs: SHORT_TTL_MS });
      await sleep(AFTER_SHORT_TTL_MS);

      const outcome = await reserve(2, 1, [{ sku: 'KOLA-1L', quantity: 1 }]);

      expect(outcome.status).toBe('reserved');
    });

    it('suresi dolmus ama kaydi duran siparis tekrar gelirse yine "zaten rezerve" (payli kayit)', async () => {
      const first = await reserve(1, 1, [{ sku: 'SUT-1L', quantity: 1 }], {
        ttlMs: SHORT_TTL_MS,
      });
      await sleep(AFTER_SHORT_TTL_MS);

      const again = await reserve(1, 1, [{ sku: 'SUT-1L', quantity: 1 }]);

      expect(again).toEqual({
        status: 'already-reserved',
        expiresAt: first.status === 'reserved' ? first.expiresAt : -1,
      });
      // On kosul: bekleme kaydin kalma payi icinde (yoksa senaryo baska sey sinardi).
      expect(RESERVATION_HOLD_AFTER_EXPIRY_MS).toBeGreaterThan(AFTER_SHORT_TTL_MS);
      expect(await counts(MARKET, ['SUT-1L'])).toEqual({ 'SUT-1L': 4 });
    });

    it('sayaclar market basinadir: bir marketteki rezervasyon digerine dokunmaz', async () => {
      await reserve(1, 1, [{ sku: 'SUT-1L', quantity: 4 }], { marketId: OTHER_MARKET });

      expect(await counts(OTHER_MARKET, ['SUT-1L'])).toEqual({ 'SUT-1L': 0 });
      expect(await counts(MARKET, ['SUT-1L'])).toEqual({ 'SUT-1L': 5 });
    });

    it('son kutu: sayac tam yetiyorsa rezerve edilir ve 0a iner; sonraki yetersiz', async () => {
      expect((await reserve(1, 1, [{ sku: 'CIKOLATA-80', quantity: 1 }])).status).toBe('reserved');

      expect(await reserve(2, 2, [{ sku: 'CIKOLATA-80', quantity: 1 }])).toEqual({
        status: 'insufficient',
        sku: 'CIKOLATA-80',
        requested: 1,
        counter: 0,
        counterMissing: false,
      });
      expect(await counts(MARKET, ['CIKOLATA-80'])).toEqual({ 'CIKOLATA-80': 0 });
    });

    const release = (order: number, reason = 'user_cancelled', marketId = MARKET) =>
      stock.reservations.release({
        orderId: orderId(order),
        marketId,
        reason,
        nowMs: systemClock.now(),
      });

    it('birakma: adetler sayaclara doner, kullanici kilidi kalkar; kalemler SKU sirasinda', async () => {
      await reserve(1, 1, [
        { sku: 'SUT-1L', quantity: 2 },
        { sku: 'KOLA-1L', quantity: 1 },
      ]);

      const outcome = await release(1);

      expect(outcome).toEqual({
        status: 'released',
        skippedCounters: 0,
        lines: [
          { sku: 'KOLA-1L', quantity: 1 },
          { sku: 'SUT-1L', quantity: 2 },
        ],
      });
      expect(await counts(MARKET, ['SUT-1L', 'KOLA-1L'])).toEqual({ 'SUT-1L': 5, 'KOLA-1L': 3 });
      // Kilit kalkti: ayni kullanici yeni siparisi hemen acar.
      expect((await reserve(2, 1, [{ sku: 'SUT-1L', quantity: 1 }])).status).toBe('reserved');
    });

    it('ikinci birakma sayaclari TEKRAR artirmaz: iz (settled) ilk gerekce ve adetlerle doner', async () => {
      await reserve(1, 1, [{ sku: 'SUT-1L', quantity: 2 }]);
      const before = systemClock.now();
      await release(1, 'user_cancelled');

      const again = await release(1, 'payment_failed');

      expect(again).toMatchObject({
        status: 'settled',
        settlement: 'released',
        reason: 'user_cancelled',
        lines: [{ sku: 'SUT-1L', quantity: 2 }],
      });
      expect(again.status === 'settled' ? again.settledAt : -1).toBeGreaterThanOrEqual(before);
      expect(await counts(MARKET, ['SUT-1L'])).toEqual({ 'SUT-1L': 5 });
    });

    it('iz silinince (forgetSettled) birakma absent; hic olmamis rezervasyon da absent', async () => {
      await reserve(1, 1, [{ sku: 'SUT-1L', quantity: 2 }]);
      await release(1);

      await stock.reservations.forgetSettled(MARKET, orderId(1));

      expect(await release(1)).toEqual({ status: 'absent' });
      expect(await release(9)).toEqual({ status: 'absent' });
      expect(await counts(MARKET, ['SUT-1L'])).toEqual({ 'SUT-1L': 5 });
    });

    it('birakma market basinadir: baska marketteki ayni siparis kimligi absent', async () => {
      await reserve(1, 1, [{ sku: 'SUT-1L', quantity: 2 }]);

      expect(await release(1, 'user_cancelled', OTHER_MARKET)).toEqual({ status: 'absent' });
      expect(await counts(MARKET, ['SUT-1L'])).toEqual({ 'SUT-1L': 3 });
    });

    it('birakilan stok baskasina satilabilir: son kutu geri doner', async () => {
      await reserve(1, 1, [{ sku: 'CIKOLATA-80', quantity: 1 }]);
      await release(1);

      expect((await reserve(2, 2, [{ sku: 'CIKOLATA-80', quantity: 1 }])).status).toBe('reserved');
    });

    it('kullanici kilidi yalnizca BU siparisinse silinir: sonraki siparisin kilidi kalir', async () => {
      await reserve(1, 1, [{ sku: 'SUT-1L', quantity: 1 }], { ttlMs: SHORT_TTL_MS });
      await sleep(AFTER_SHORT_TTL_MS);
      await reserve(2, 1, [{ sku: 'KOLA-1L', quantity: 1 }]);

      // Suresi dolmus ama supurulmemis ilk siparis birakilir (kaydi pay icinde).
      expect((await release(1)).status).toBe('released');

      expect(await reserve(3, 1, [{ sku: 'CIPS-150', quantity: 1 }])).toMatchObject({
        status: 'user-has-active',
        activeOrderId: orderId(2),
      });
    });

    const commit = (order: number, marketId = MARKET) =>
      stock.reservations.commit({ orderId: orderId(order), marketId, nowMs: systemClock.now() });

    it('onay: sayaclara DOKUNULMAZ (adet zaten dustu), kullanici kilidi kalkar; kalemler SKU sirasinda', async () => {
      await reserve(1, 1, [
        { sku: 'SUT-1L', quantity: 2 },
        { sku: 'KOLA-1L', quantity: 1 },
      ]);

      expect(await commit(1)).toEqual({
        status: 'committed',
        lines: [
          { sku: 'KOLA-1L', quantity: 1 },
          { sku: 'SUT-1L', quantity: 2 },
        ],
      });
      expect(await counts(MARKET, ['SUT-1L', 'KOLA-1L'])).toEqual({ 'SUT-1L': 3, 'KOLA-1L': 2 });
      expect((await reserve(2, 1, [{ sku: 'SUT-1L', quantity: 1 }])).status).toBe('reserved');
    });

    it('ikinci onay: iz (settled, committed) doner; iz silinince absent', async () => {
      await reserve(1, 1, [{ sku: 'SUT-1L', quantity: 2 }]);
      await commit(1);

      expect(await commit(1)).toMatchObject({
        status: 'settled',
        settlement: 'committed',
        lines: [{ sku: 'SUT-1L', quantity: 2 }],
      });
      await stock.reservations.forgetSettled(MARKET, orderId(1));
      expect(await commit(1)).toEqual({ status: 'absent' });
    });

    it('onaylanan rezervasyon birakilamaz: birakma izi (committed) gorur, sayaclar ARTMAZ', async () => {
      await reserve(1, 1, [{ sku: 'SUT-1L', quantity: 2 }]);
      await commit(1);

      expect(await release(1)).toMatchObject({ status: 'settled', settlement: 'committed' });
      expect(await counts(MARKET, ['SUT-1L'])).toEqual({ 'SUT-1L': 3 });
    });

    it('birakilan rezervasyon onaylanamaz: onay izi (released) gorur; hic olmamis ve baska market absent', async () => {
      await reserve(1, 1, [{ sku: 'SUT-1L', quantity: 2 }]);
      await release(1);

      expect(await commit(1)).toMatchObject({ status: 'settled', settlement: 'released' });
      expect(await counts(MARKET, ['SUT-1L'])).toEqual({ 'SUT-1L': 5 });
      await reserve(2, 2, [{ sku: 'KOLA-1L', quantity: 1 }]);
      expect(await commit(2, OTHER_MARKET)).toEqual({ status: 'absent' });
      expect(await commit(9)).toEqual({ status: 'absent' });
    });

    // ---------- sure dolumu (T10.3) ----------
    // Bitis ani gecmiste olsun diye rezervasyon gecmis bir "simdi" ile acilir;
    // Redis'te kaydin omru gercek zamanlidir (sure + pay), kayit yerinde kalir.
    const expiredAgo = (
      order: number,
      user: number,
      lines: readonly ReservationLine[],
      agoMs = 1_000,
    ) =>
      reserve(order, user, lines, {
        nowMs: systemClock.now() - TEN_MINUTES_MS - agoMs,
        ttlMs: TEN_MINUTES_MS,
      });
    const expire = (order: number) =>
      stock.reservations.expire({
        orderId: orderId(order),
        marketId: MARKET,
        nowMs: systemClock.now(),
      });

    it('listDue: bitis ani gelmisler en eskisi once, sinira kadar; gelmeyen ve sonuclanan yok', async () => {
      await expiredAgo(1, 1, [{ sku: 'SUT-1L', quantity: 1 }], 1_000);
      await expiredAgo(2, 2, [{ sku: 'SUT-1L', quantity: 1 }], 5_000);
      await expiredAgo(3, 3, [{ sku: 'KOLA-1L', quantity: 1 }], 3_000);
      await reserve(4, 4, [{ sku: 'KOLA-1L', quantity: 1 }]);
      await expiredAgo(5, 5, [{ sku: 'CIPS-150', quantity: 1 }], 2_000);
      await release(5);

      const nowMs = systemClock.now();
      expect(await stock.reservations.listDue(MARKET, nowMs, 10)).toEqual([
        orderId(2),
        orderId(3),
        orderId(1),
      ]);
      expect(await stock.reservations.listDue(MARKET, nowMs, 2)).toEqual([orderId(2), orderId(3)]);
      expect(await stock.reservations.listDue(OTHER_MARKET, nowMs, 10)).toEqual([]);
    });

    it('sure dolumu: adetler sayaca doner, kilit kalkar; ikinci kez settled (expired)', async () => {
      await expiredAgo(1, 1, [
        { sku: 'SUT-1L', quantity: 2 },
        { sku: 'KOLA-1L', quantity: 1 },
      ]);

      expect(await expire(1)).toEqual({
        status: 'expired',
        skippedCounters: 0,
        lines: [
          { sku: 'KOLA-1L', quantity: 1 },
          { sku: 'SUT-1L', quantity: 2 },
        ],
      });
      expect(await counts(MARKET, ['SUT-1L', 'KOLA-1L'])).toEqual({ 'SUT-1L': 5, 'KOLA-1L': 3 });
      expect(await expire(1)).toMatchObject({ status: 'settled', settlement: 'expired' });
      expect(await stock.reservations.listDue(MARKET, systemClock.now(), 10)).toEqual([]);
    });

    it('bitis ani gelmemis rezervasyona sure dolumu DOKUNMAZ (not-due): uzatilmis olabilir', async () => {
      await reserve(1, 1, [{ sku: 'SUT-1L', quantity: 2 }]);

      expect(await expire(1)).toEqual({ status: 'not-due' });
      expect(await counts(MARKET, ['SUT-1L'])).toEqual({ 'SUT-1L': 3 });
      expect((await commit(1)).status).toBe('committed');
    });

    it('suresi dolan onaylanamaz, birakilamaz (iz expired); onaylanan ya da birakilan sure dolumunda settled', async () => {
      await expiredAgo(1, 1, [{ sku: 'SUT-1L', quantity: 2 }]);
      await expire(1);
      expect(await commit(1)).toMatchObject({ status: 'settled', settlement: 'expired' });
      expect(await release(1)).toMatchObject({ status: 'settled', settlement: 'expired' });
      expect(await counts(MARKET, ['SUT-1L'])).toEqual({ 'SUT-1L': 5 });

      await expiredAgo(2, 2, [{ sku: 'KOLA-1L', quantity: 1 }]);
      await commit(2);
      expect(await expire(2)).toMatchObject({ status: 'settled', settlement: 'committed' });
      expect(await counts(MARKET, ['KOLA-1L'])).toEqual({ 'KOLA-1L': 2 });
      expect(await expire(9)).toEqual({ status: 'absent' });
    });

    // ---------- uzatma ve kisaltma (T11.3, B21) ----------
    const ONE_MINUTE_MS = 60_000;
    const extend = (
      order: number,
      options: { additionalMs?: number; maxExtensions?: number; nowMs?: number } = {},
    ) =>
      stock.reservations.extend({
        orderId: orderId(order),
        marketId: MARKET,
        nowMs: options.nowMs ?? systemClock.now(),
        additionalMs: options.additionalMs ?? ONE_MINUTE_MS,
        maxExtensions: options.maxExtensions ?? 3,
      });
    const shorten = (order: number, maxRemainingMs: number, nowMs = systemClock.now()) =>
      stock.reservations.shorten({
        orderId: orderId(order),
        marketId: MARKET,
        nowMs,
        maxRemainingMs,
      });

    it('uzatma: bitis eklenen sure kadar ileri, sayac 1; kalemler SKU sirasinda doner', async () => {
      const nowMs = systemClock.now();
      await reserve(
        1,
        1,
        [
          { sku: 'SUT-1L', quantity: 2 },
          { sku: 'KOLA-1L', quantity: 1 },
        ],
        { nowMs },
      );

      expect(await extend(1)).toEqual({
        status: 'extended',
        expiresAt: nowMs + TEN_MINUTES_MS + ONE_MINUTE_MS,
        extensionCount: 1,
        lines: [
          { sku: 'KOLA-1L', quantity: 1 },
          { sku: 'SUT-1L', quantity: 2 },
        ],
      });
      expect(await counts(MARKET, ['SUT-1L', 'KOLA-1L'])).toEqual({ 'SUT-1L': 3, 'KOLA-1L': 2 });
    });

    it('hak sinirli (B21): ucuncu uzatmadan sonra sure DEGISMEZ, limit-reached; hak 0 ise hic uzamaz', async () => {
      const nowMs = systemClock.now();
      await reserve(1, 1, [{ sku: 'SUT-1L', quantity: 1 }], { nowMs });
      await extend(1);
      await extend(1);
      const third = await extend(1);

      expect(third).toMatchObject({
        status: 'extended',
        expiresAt: nowMs + TEN_MINUTES_MS + 3 * ONE_MINUTE_MS,
        extensionCount: 3,
      });
      expect(await extend(1)).toEqual({
        status: 'limit-reached',
        expiresAt: nowMs + TEN_MINUTES_MS + 3 * ONE_MINUTE_MS,
        extensionCount: 3,
      });

      await reserve(2, 2, [{ sku: 'KOLA-1L', quantity: 1 }], { nowMs });
      expect(await extend(2, { maxExtensions: 0 })).toEqual({
        status: 'limit-reached',
        expiresAt: nowMs + TEN_MINUTES_MS,
        extensionCount: 0,
      });
    });

    it('uzatilan rezervasyona sure dolumu DOKUNMAZ: eski bitis gecse de not-due, listDue bos', async () => {
      const nowMs = systemClock.now();
      await reserve(1, 1, [{ sku: 'SUT-1L', quantity: 2 }], { nowMs, ttlMs: 5_000 });
      await extend(1, { nowMs });
      const afterOldExpiry = nowMs + 10_000;

      expect(await stock.reservations.listDue(MARKET, afterOldExpiry, 10)).toEqual([]);
      expect(
        await stock.reservations.expire({
          orderId: orderId(1),
          marketId: MARKET,
          nowMs: afterOldExpiry,
        }),
      ).toEqual({ status: 'not-due' });
      expect(await counts(MARKET, ['SUT-1L'])).toEqual({ 'SUT-1L': 3 });
    });

    it('kullanici kilidi uzatmayla BIRLIKTE uzar: eski bitis gecince ayni kullanici ikinci kilit ACAMAZ (B22)', async () => {
      await reserve(1, 1, [{ sku: 'SUT-1L', quantity: 1 }], { ttlMs: SHORT_TTL_MS });
      await extend(1, { additionalMs: 2_000 });
      await sleep(AFTER_SHORT_TTL_MS);

      expect(await reserve(2, 1, [{ sku: 'KOLA-1L', quantity: 1 }])).toMatchObject({
        status: 'user-has-active',
        activeOrderId: orderId(1),
      });
    });

    it('bitis ani gecmis rezervasyon UZATILMAZ (due): dusmus kilit diriltilmez; supurucu yine birakir', async () => {
      await expiredAgo(1, 1, [{ sku: 'SUT-1L', quantity: 2 }]);

      expect(await extend(1)).toEqual({ status: 'inactive', reason: 'due' });
      expect(await expire(1)).toMatchObject({ status: 'expired' });
      expect(await counts(MARKET, ['SUT-1L'])).toEqual({ 'SUT-1L': 5 });
    });

    it('aktif olmayan uzatilmaz, kisaltilmaz: birakilmis ve onaylanmis settled, hic olmamis absent', async () => {
      await reserve(1, 1, [{ sku: 'SUT-1L', quantity: 1 }]);
      await release(1);
      await reserve(2, 2, [{ sku: 'KOLA-1L', quantity: 1 }]);
      await commit(2);

      expect(await extend(1)).toEqual({ status: 'inactive', reason: 'settled' });
      expect(await extend(2)).toEqual({ status: 'inactive', reason: 'settled' });
      expect(await extend(9)).toEqual({ status: 'inactive', reason: 'absent' });
      expect(await shorten(1, ONE_MINUTE_MS)).toEqual({ status: 'inactive', reason: 'settled' });
      expect(await shorten(9, ONE_MINUTE_MS)).toEqual({ status: 'inactive', reason: 'absent' });
    });

    it('kisaltma: kalan sure sinira iner; zaten kisaysa unchanged; ASLA uzatmaz', async () => {
      const nowMs = systemClock.now();
      await reserve(1, 1, [{ sku: 'SUT-1L', quantity: 1 }], { nowMs });

      expect(await shorten(1, 2 * ONE_MINUTE_MS, nowMs)).toEqual({
        status: 'shortened',
        expiresAt: nowMs + 2 * ONE_MINUTE_MS,
      });
      expect(await shorten(1, 5 * ONE_MINUTE_MS, nowMs)).toEqual({
        status: 'unchanged',
        expiresAt: nowMs + 2 * ONE_MINUTE_MS,
      });
      expect(await counts(MARKET, ['SUT-1L'])).toEqual({ 'SUT-1L': 4 });
    });

    it('kisaltilan rezervasyon yeni bitiste duser: kullanici kilidi de; supurucu birakir', async () => {
      await reserve(1, 1, [{ sku: 'SUT-1L', quantity: 2 }]);
      await shorten(1, SHORT_TTL_MS);
      await sleep(AFTER_SHORT_TTL_MS);

      expect(await stock.reservations.listDue(MARKET, systemClock.now(), 10)).toEqual([orderId(1)]);
      expect(await expire(1)).toMatchObject({ status: 'expired' });
      expect((await reserve(2, 1, [{ sku: 'KOLA-1L', quantity: 1 }])).status).toBe('reserved');
      expect(await counts(MARKET, ['SUT-1L'])).toEqual({ 'SUT-1L': 5 });
    });

    it('kisaltmadan sonra uzatma kisaltilmis bitise eklenir (orta bant + odeme denemesi)', async () => {
      const nowMs = systemClock.now();
      await reserve(1, 1, [{ sku: 'SUT-1L', quantity: 1 }], { nowMs });
      await shorten(1, 2 * ONE_MINUTE_MS, nowMs);

      expect(await extend(1, { nowMs })).toMatchObject({
        status: 'extended',
        expiresAt: nowMs + 3 * ONE_MINUTE_MS,
        extensionCount: 1,
      });
    });

    it('tekrar eden SKU depoya ulasirsa INTERNAL; hicbir sey yazilmaz (fazla satis olurdu)', async () => {
      const attempt = reserve(1, 1, [
        { sku: 'CIKOLATA-80', quantity: 1 },
        { sku: 'CIKOLATA-80', quantity: 1 },
      ]);

      await expect(attempt).rejects.toBeInstanceOf(AppError);
      await expect(attempt).rejects.toMatchObject({ code: ERROR_CODES.INTERNAL });
      expect(await counts(MARKET, ['CIKOLATA-80'])).toEqual({ 'CIKOLATA-80': 1 });
    });
  });
}
