/**
 * Birakma use-case'i (T10.2, ADR-18): depo ve defter sahte. Sira ve yarida
 * kalan kaydin tamamlanmasi burada; gercek Redis ve Mongo ile
 * test/integration/stock-stores.spec.ts'te.
 */

import { AppError, ERROR_CODES, fixedClock } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { createReleaseReservation } from '../../src/application/release-reservation.js';
import type { ReleaseCommand, ReleaseOutcome } from '../../src/domain/reservation.js';
import type { LedgerEntry, StockLedger } from '../../src/domain/stock-ledger.js';

const NOW = Date.UTC(2026, 9, 1, 9, 0, 0);
const INPUT = {
  orderId: 'ord_00000000000000000000000000000001',
  marketId: 'mkt_migros-jet-moda',
  reason: 'user_cancelled',
};
const LINES = [
  { sku: 'KOLA-1L', quantity: 1 },
  { sku: 'SUT-1L', quantity: 2 },
];

function setup(
  outcome: ReleaseOutcome,
  options: { settlement?: 'released'; record?: () => Promise<void> } = {},
) {
  const calls: string[] = [];
  const commands: ReleaseCommand[] = [];
  const recorded: LedgerEntry[][] = [];
  const lines: LogLine[] = [];
  const ledger: StockLedger = {
    record: vi.fn(async (entries: readonly LedgerEntry[]) => {
      calls.push('record');
      await (options.record ?? (() => Promise.resolve()))();
      recorded.push([...entries]);
    }),
    settlementOf: vi.fn(() => {
      calls.push('settlementOf');
      return Promise.resolve(options.settlement);
    }),
  };
  const release = createReleaseReservation({
    reservations: {
      release: (command) => {
        calls.push('release');
        commands.push(command);
        return Promise.resolve(outcome);
      },
      forgetSettled: vi.fn(() => {
        calls.push('forgetSettled');
        return Promise.resolve();
      }),
    },
    ledger,
    clock: fixedClock(NOW),
    logger: recordingLogger(lines),
  });
  return { release, calls, commands, recorded, lines };
}

describe('createReleaseReservation', () => {
  it('sahiplik bu cagrinin: defter (delta 0) yazilir, SONRA iz silinir -> applied', async () => {
    const { release, calls, commands, recorded, lines } = setup({
      status: 'released',
      skippedCounters: 0,
      lines: LINES,
    });

    expect(await release(INPUT)).toEqual({ outcome: 'applied' });
    expect(commands).toEqual([{ ...INPUT, nowMs: NOW }]);
    expect(calls).toEqual(['release', 'record', 'forgetSettled']);
    expect(recorded).toEqual([
      LINES.map(({ sku, quantity }) => ({
        marketId: INPUT.marketId,
        sku,
        kind: 'release',
        delta: 0,
        quantity,
        reason: 'user_cancelled',
        orderId: INPUT.orderId,
        at: new Date(NOW),
      })),
    ]);
    expect(lines).toEqual([]);
  });

  it('sayaci olmayan kalem atlandiysa UYARI yazilir (stok sayac kurtarmasina kalir)', async () => {
    const { release, lines } = setup({ status: 'released', skippedCounters: 1, lines: LINES });

    await release(INPUT);

    expect(lines.map((line) => [line.level, line.fields['skipped']])).toEqual([['warn', 1]]);
  });

  it('defter yazilamazsa hata doner ve iz SILINMEZ: sayaclar zaten dondu, tekrar deneme tamamlar', async () => {
    const { release, calls } = setup(
      { status: 'released', skippedCounters: 0, lines: LINES },
      {
        record: () => Promise.reject(new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'mongo kapali')),
      },
    );

    await expect(release(INPUT)).rejects.toMatchObject({ code: ERROR_CODES.SERVICE_UNAVAILABLE });
    expect(calls).toEqual(['release', 'record']);
  });

  it('iz duruyor (onceki cagri yarida kaldi): defter ONCEKI gerekce ve anla tamamlanir -> already-applied', async () => {
    const settledAt = NOW - 5_000;
    const { release, calls, recorded } = setup({
      status: 'settled',
      settlement: 'released',
      reason: 'risk_rejected',
      settledAt,
      lines: LINES,
    });

    expect(await release({ ...INPUT, reason: 'user_cancelled' })).toEqual({
      outcome: 'already-applied',
    });
    expect(calls).toEqual(['release', 'record', 'forgetSettled']);
    expect(recorded[0]?.map((entry) => [entry.reason, entry.at])).toEqual([
      ['risk_rejected', new Date(settledAt)],
      ['risk_rejected', new Date(settledAt)],
    ]);
  });

  it('onay izi: onaylanan stok geri verilmez -> not-found; defter YAZILMAZ, ize dokunulmaz', async () => {
    const { release, calls } = setup({
      status: 'settled',
      settlement: 'committed',
      reason: 'order_paid',
      settledAt: NOW - 1_000,
      lines: LINES,
    });

    expect(await release(INPUT)).toEqual({ outcome: 'not-found' });
    expect(calls).toEqual(['release']);
  });

  it('ne rezervasyon ne iz var: defterde birakildiysa already-applied, kaydi yoksa not-found', async () => {
    const released = setup({ status: 'absent' }, { settlement: 'released' });
    const unknown = setup({ status: 'absent' });

    expect(await released.release(INPUT)).toEqual({ outcome: 'already-applied' });
    expect(await unknown.release(INPUT)).toEqual({ outcome: 'not-found' });
    expect(unknown.calls).toEqual(['release', 'settlementOf']);
  });

  it('indekste olup kaydi dusmus rezervasyon: UYARI, sonuc defterden (burada not-found)', async () => {
    const { release, lines } = setup({ status: 'orphaned' });

    expect(await release(INPUT)).toEqual({ outcome: 'not-found' });
    expect(lines.map((line) => line.level)).toEqual(['warn']);
  });
});
