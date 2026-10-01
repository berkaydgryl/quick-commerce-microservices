/**
 * Supurme turu (T10.3; ADR-02, ADR-18): depo, defter ve market kaynagi sahte.
 * Gercek Redis ile test/integration/reservation.spec.ts, Mongo ile
 * test/integration/stock-stores.spec.ts.
 */

import { AppError, ERROR_CODES, fixedClock } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { createSweepExpired } from '../../src/application/sweep-expired.js';
import type { ExpireOutcome } from '../../src/domain/reservation.js';
import type { LedgerEntry } from '../../src/domain/stock-ledger.js';

const NOW = Date.UTC(2026, 9, 1, 12, 0, 0);
const MARKET = 'mkt_migros-jet-moda';
const OTHER = 'mkt_a101-caferaga';
const order = (n: number) => `ord_${n.toString(16).padStart(32, '0')}`;
const LINES = [{ sku: 'SUT-1L', quantity: 2 }];
const REFRESH_MS = 60_000;

interface Setup {
  /** Market -> bitis ani gelmis siparisler. Islenen siparis indeksten cikar (ZREM gibi). */
  readonly due?: Readonly<Record<string, readonly string[]>>;
  readonly outcomes?: Readonly<Record<string, ExpireOutcome | (() => Promise<ExpireOutcome>)>>;
  readonly record?: () => Promise<void>;
}

function setup(options: Setup = {}) {
  const clock = fixedClock(NOW);
  const lines: LogLine[] = [];
  const recorded: LedgerEntry[][] = [];
  const forgotten: string[] = [];
  const limits: number[] = [];
  const marketIds = vi.fn(() => Promise.resolve([MARKET, OTHER]));
  const index = new Map(
    Object.entries(options.due ?? {}).map(([market, ids]) => [market, [...ids]]),
  );
  const sweep = createSweepExpired({
    markets: { marketIds },
    reservations: {
      listDue: (marketId, nowMs, limit) => {
        expect(nowMs).toBe(clock.now());
        limits.push(limit);
        return Promise.resolve([...(index.get(marketId) ?? [])]);
      },
      expire: (command) => {
        // Gercekte script sahipligi alinca (ya da iz varsa) uye indeksten cikmistir.
        index.set(
          command.marketId,
          (index.get(command.marketId) ?? []).filter((id) => id !== command.orderId),
        );
        const outcome = options.outcomes?.[command.orderId] ?? { status: 'absent' };
        return typeof outcome === 'function' ? outcome() : Promise.resolve(outcome);
      },
      forgetSettled: (_marketId, orderId) => {
        forgotten.push(orderId);
        return Promise.resolve();
      },
    },
    ledger: {
      record: async (entries) => {
        await (options.record ?? (() => Promise.resolve()))();
        recorded.push([...entries]);
      },
    },
    clock,
    logger: recordingLogger(lines),
    batchSize: 25,
    marketRefreshMs: REFRESH_MS,
  });
  return { sweep, clock, lines, recorded, forgotten, limits, marketIds };
}

describe('createSweepExpired', () => {
  it('suresi dolani birakir: defter (expire, delta 0, simdi), sonra iz silinir; market basina sinir', async () => {
    const { sweep, recorded, forgotten, limits } = setup({
      due: { [MARKET]: [order(1)] },
      outcomes: { [order(1)]: { status: 'expired', skippedCounters: 0, lines: LINES } },
    });

    expect(await sweep()).toEqual({ expired: 1, completed: 0, pending: 0 });
    expect(recorded).toEqual([
      [
        {
          marketId: MARKET,
          sku: 'SUT-1L',
          kind: 'expire',
          delta: 0,
          quantity: 2,
          reason: 'expired',
          orderId: order(1),
          at: new Date(NOW),
        },
      ],
    ]);
    expect(forgotten).toEqual([order(1)]);
    expect(limits).toEqual([25, 25]);
  });

  it('bitis ani gelmemis, yok ya da baska yoldan sonuclanmis siparise dokunulmaz', async () => {
    const { sweep, recorded, forgotten } = setup({
      due: { [MARKET]: [order(1), order(2), order(3)] },
      outcomes: {
        [order(1)]: { status: 'not-due' },
        [order(2)]: { status: 'absent' },
        [order(3)]: {
          status: 'settled',
          settlement: 'committed',
          reason: 'order_paid',
          settledAt: NOW - 1,
          lines: LINES,
        },
      },
    });

    expect(await sweep()).toEqual({ expired: 0, completed: 0, pending: 0 });
    expect(recorded).toEqual([]);
    expect(forgotten).toEqual([]);
  });

  it('defteri yarida kalmis sure dolumu (iz expired) izin aniyla tamamlanir', async () => {
    const settledAt = NOW - 5_000;
    const { sweep, recorded, forgotten } = setup({
      due: { [MARKET]: [order(1)] },
      outcomes: {
        [order(1)]: {
          status: 'settled',
          settlement: 'expired',
          reason: 'expired',
          settledAt,
          lines: LINES,
        },
      },
    });

    expect(await sweep()).toEqual({ expired: 0, completed: 1, pending: 0 });
    expect(recorded[0]?.[0]?.at).toEqual(new Date(settledAt));
    expect(forgotten).toEqual([order(1)]);
  });

  it('defter yazilamazsa stok yine doner, siparis bekler; sonraki turda izden tamamlanir', async () => {
    let failures = 1;
    let calls = 0;
    const { sweep, lines, forgotten } = setup({
      due: { [MARKET]: [order(1)] },
      outcomes: {
        [order(1)]: () => {
          calls += 1;
          return Promise.resolve<ExpireOutcome>(
            calls === 1
              ? { status: 'expired', skippedCounters: 0, lines: LINES }
              : {
                  status: 'settled',
                  settlement: 'expired',
                  reason: 'expired',
                  settledAt: NOW,
                  lines: LINES,
                },
          );
        },
      },
      record: () => {
        if (failures > 0) {
          failures -= 1;
          return Promise.reject(new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'mongo kapali'));
        }
        return Promise.resolve();
      },
    });

    expect(await sweep()).toEqual({ expired: 1, completed: 0, pending: 1 });
    expect(forgotten).toEqual([]);
    expect(lines.map((line) => line.level)).toEqual(['warn']);

    // Ikinci tur: indeks artik onu listelemez; bekleyenlerden izle tamamlanir.
    expect(await sweep()).toEqual({ expired: 0, completed: 1, pending: 0 });
    expect(forgotten).toEqual([order(1)]);
  });

  it('tek siparisin hatasi turu durdurmaz; kaydi dusmus ve sayaci olmayan kalem uyari yazar', async () => {
    const { sweep, lines } = setup({
      due: { [MARKET]: [order(1), order(2), order(3)] },
      outcomes: {
        [order(1)]: () => Promise.reject(AppError.internal('stok sayaci bozuk')),
        [order(2)]: { status: 'orphaned' },
        [order(3)]: { status: 'expired', skippedCounters: 1, lines: LINES },
      },
    });

    expect(await sweep()).toEqual({ expired: 1, completed: 0, pending: 0 });
    expect(lines.map((line) => [line.level, line.message])).toEqual([
      ['error', 'sure dolumu basarisiz'],
      ['warn', 'sure dolumu: indeksteki rezervasyonun kaydi yok; stok geri verilemedi'],
      ['warn', 'sure dolumu: sayaci olmayan kalem geri eklenmedi'],
    ]);
  });

  it('market listesi tazeleme araligi icinde bir kez okunur, aralik dolunca yeniden', async () => {
    const { sweep, clock, marketIds } = setup();

    await sweep();
    clock.advance(REFRESH_MS - 1);
    await sweep();
    clock.advance(1);
    await sweep();

    expect(marketIds).toHaveBeenCalledTimes(2);
  });
});
