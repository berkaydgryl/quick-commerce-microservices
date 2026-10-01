/**
 * Onay use-case'i (T10.2 PR 2, ADR-18): depo, onay yazimi ve defter sahte.
 * Sira, yarida kalan onayin tamamlanmasi ve eksiye dusen adet burada; gercek
 * Redis ve Mongo ile test/integration/stock-stores.spec.ts'te.
 */

import { AppError, ERROR_CODES, fixedClock } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { createCommitReservation } from '../../src/application/commit-reservation.js';
import type { CommitOutcome, ReservationSettlement } from '../../src/domain/reservation.js';
import type { CommitWriteResult, LedgerEntry } from '../../src/domain/stock-ledger.js';

const NOW = Date.UTC(2026, 9, 1, 12, 0, 0);
const INPUT = {
  orderId: 'ord_00000000000000000000000000000001',
  marketId: 'mkt_migros-jet-moda',
};
const LINES = [
  { sku: 'KOLA-1L', quantity: 1 },
  { sku: 'SUT-1L', quantity: 2 },
];

function setup(
  outcome: CommitOutcome,
  options: {
    settlement?: ReservationSettlement;
    write?: () => Promise<CommitWriteResult>;
  } = {},
) {
  const calls: string[] = [];
  const written: LedgerEntry[][] = [];
  const lines: LogLine[] = [];
  const commit = createCommitReservation({
    reservations: {
      commit: (command) => {
        calls.push(`commit@${command.nowMs}`);
        return Promise.resolve(outcome);
      },
      forgetSettled: vi.fn(() => {
        calls.push('forgetSettled');
        return Promise.resolve();
      }),
    },
    committer: {
      commit: vi.fn(async (entries: readonly LedgerEntry[]) => {
        calls.push('committer');
        written.push([...entries]);
        return (
          options.write ?? (() => Promise.resolve({ written: entries.length, negative: [] }))
        )();
      }),
    },
    ledger: {
      settlementOf: () => {
        calls.push('settlementOf');
        return Promise.resolve(options.settlement);
      },
    },
    clock: fixedClock(NOW),
    logger: recordingLogger(lines),
  });
  return { commit, calls, written, lines };
}

describe('createCommitReservation', () => {
  it('sahiplik bu cagrinin: defter (-adet) + eldeki adet yazilir, SONRA iz silinir -> applied', async () => {
    const { commit, calls, written, lines } = setup({ status: 'committed', lines: LINES });

    expect(await commit(INPUT)).toEqual({ outcome: 'applied' });
    expect(calls).toEqual([`commit@${NOW}`, 'committer', 'forgetSettled']);
    expect(written).toEqual([
      LINES.map(({ sku, quantity }) => ({
        marketId: INPUT.marketId,
        sku,
        kind: 'commit',
        delta: -quantity,
        quantity,
        reason: 'order_paid',
        orderId: INPUT.orderId,
        at: new Date(NOW),
      })),
    ]);
    expect(lines).toEqual([]);
  });

  it('eldeki adet eksiye duserse onay YINE yapilir; kalem basina UYARI (fazla satis izi)', async () => {
    const { commit, lines } = setup(
      { status: 'committed', lines: LINES },
      { write: () => Promise.resolve({ written: 2, negative: [{ sku: 'SUT-1L', onHand: -1 }] }) },
    );

    expect(await commit(INPUT)).toEqual({ outcome: 'applied' });
    expect(lines.map((line) => [line.level, line.fields['sku'], line.fields['onHand']])).toEqual([
      ['warn', 'SUT-1L', -1],
    ]);
  });

  it('yazim duserse (Mongo erisilemez ya da P3 denemeleri bitti) hata doner, iz SILINMEZ', async () => {
    const { commit, calls } = setup(
      { status: 'committed', lines: LINES },
      { write: () => Promise.reject(AppError.conflict('Stok kaydi ayni anda degisti')) },
    );

    await expect(commit(INPUT)).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
    expect(calls).toEqual([`commit@${NOW}`, 'committer']);
  });

  it('onay izi duruyor (onceki cagri yarida kaldi): yazim ONCEKI anla tamamlanir -> already-applied', async () => {
    const settledAt = NOW - 5_000;
    const { commit, calls, written } = setup({
      status: 'settled',
      settlement: 'committed',
      reason: 'order_paid',
      settledAt,
      lines: LINES,
    });

    expect(await commit(INPUT)).toEqual({ outcome: 'already-applied' });
    expect(calls).toEqual([`commit@${NOW}`, 'committer', 'forgetSettled']);
    expect(written[0]?.map((entry) => entry.at)).toEqual([
      new Date(settledAt),
      new Date(settledAt),
    ]);
  });

  it('birakma izi: onaylanamaz -> not-found; yazim YOK, ize dokunulmaz', async () => {
    const { commit, calls } = setup({
      status: 'settled',
      settlement: 'released',
      reason: 'user_cancelled',
      settledAt: NOW - 1_000,
      lines: LINES,
    });

    expect(await commit(INPUT)).toEqual({ outcome: 'not-found' });
    expect(calls).toEqual([`commit@${NOW}`]);
  });

  it('ne rezervasyon ne iz: defterde onaylandiysa already-applied, birakildiysa ya da yoksa not-found', async () => {
    const committed = setup({ status: 'absent' }, { settlement: 'committed' });
    const released = setup({ status: 'absent' }, { settlement: 'released' });
    const unknown = setup({ status: 'absent' });

    expect(await committed.commit(INPUT)).toEqual({ outcome: 'already-applied' });
    expect(await released.commit(INPUT)).toEqual({ outcome: 'not-found' });
    expect(await unknown.commit(INPUT)).toEqual({ outcome: 'not-found' });
  });

  it('indekste olup kaydi dusmus rezervasyon: UYARI, sonuc defterden', async () => {
    const { commit, lines } = setup({ status: 'orphaned' });

    expect(await commit(INPUT)).toEqual({ outcome: 'not-found' });
    expect(lines.map((line) => line.level)).toEqual(['warn']);
  });
});
