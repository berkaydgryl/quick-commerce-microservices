/**
 * Uzatma use-case'inde beklenen bitis (T15.3; bekleyen is 117, QA IQ3): bitis
 * tutmazsa guncel hal doner, hak harcanmaz; eksik defter kayitlari 1'den sayiya
 * kadar en iyi gayretle ve cevabi BEKLETMEDEN tamamlanir. Depo sahte; iki
 * deponun kurali reservation-extend-expected-contract.ts'te.
 */

import { fixedClock, silentLogger } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { createExtendReservation } from '../../src/application/extend-reservation.js';
import type { ExtendOutcome } from '../../src/domain/reservation.js';
import type { LedgerEntry } from '../../src/domain/stock-ledger.js';
import { InMemoryStockLedger } from '../../src/infrastructure/memory/in-memory-stock-ledger.js';

const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
const MARKET = 'mkt_migros-jet-moda';
const ORDER = 'ord_00000000000000000000000000000001';
const EXPECTED = new Date(NOW + 600_000);
const INPUT = {
  orderId: ORDER,
  marketId: MARKET,
  additionalSeconds: 60,
  expectedExpiresAt: EXPECTED,
};
const LINES = [
  { sku: 'KOLA-1L', quantity: 1 },
  { sku: 'SUT-1L', quantity: 2 },
];

function setup(outcome: ExtendOutcome, record: (entries: readonly LedgerEntry[]) => Promise<void>) {
  const lines: LogLine[] = [];
  const extend = vi.fn(() => Promise.resolve(outcome));
  const ledger = { record: vi.fn(record) };
  const run = createExtendReservation({
    reservations: { extend },
    ledger,
    clock: fixedClock(NOW),
    logger: recordingLogger(lines),
    maxExtensions: 3,
  });
  return { run, extend, ledger, lines };
}

const mismatch = (extensionCount: number): ExtendOutcome => ({
  status: 'expiry-mismatch',
  expiresAt: NOW + 660_000,
  extensionCount,
  lines: LINES,
});

/** Bekletilmeyen defter yaziminin calismasi icin olay dongusune bir tur. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('ExtendReservation use-case: beklenen bitis (T15.3)', () => {
  it('beklenen bitisi depoya ms olarak gecirir', async () => {
    const { run, extend } = setup(
      { status: 'extended', expiresAt: NOW + 660_000, extensionCount: 1, lines: LINES },
      () => Promise.resolve(),
    );

    await run(INPUT);

    expect(extend).toHaveBeenCalledWith(
      expect.objectContaining({ expectedExpiresAt: EXPECTED.getTime() }),
    );
  });

  it('uyusmazlikta guncel hal doner (hak harcanmadi); 1..n eksik uzatma kaydi tamamlanir', async () => {
    const { run, ledger, lines } = setup(mismatch(2), () => Promise.resolve());

    expect(await run(INPUT)).toEqual({
      expiresAt: new Date(NOW + 660_000),
      alreadyExtended: false,
      extensionCount: 2,
      expiryMismatch: true,
    });
    await settle();

    const written = ledger.record.mock.calls.flatMap(([entries]) => entries);
    expect(written.map((entry) => [entry.sku, entry.kind, entry.sequence, entry.delta])).toEqual([
      ['KOLA-1L', 'extend', 1, 0],
      ['SUT-1L', 'extend', 1, 0],
      ['KOLA-1L', 'extend', 2, 0],
      ['SUT-1L', 'extend', 2, 0],
    ]);
    expect(lines.map((line) => [line.level, line.message])).toEqual([
      ['info', 'rezervasyon uzatilmadi: beklenen bitis tutmadi; guncel hal donuldu'],
    ]);
  });

  it('tamamlama cevabi BEKLETMEZ: defter hic cevap vermese de cevap doner', async () => {
    const { run } = setup(mismatch(1), () => new Promise<void>(() => {}));

    await expect(run(INPUT)).resolves.toMatchObject({ expiryMismatch: true });
  });

  it('tamamlama yazilamazsa cevap yine basarili; UYARI yazilir', async () => {
    const { run, lines } = setup(mismatch(1), () => Promise.reject(new Error('mongo kapali')));

    expect((await run(INPUT)).expiryMismatch).toBe(true);
    await settle();

    expect(lines.find((line) => line.level === 'warn')?.message).toBe(
      'eksik uzatma kaydi tamamlanamadi (beklenen bitis tutmadi); cevap etkilenmez',
    );
  });

  it('gercek defterde var olan kayda dokunulmaz, kayit tek kalir (ilk an korunur)', async () => {
    const ledger = new InMemoryStockLedger();
    const outcomes: ExtendOutcome[] = [
      { status: 'extended', expiresAt: NOW + 660_000, extensionCount: 1, lines: LINES },
      mismatch(1),
    ];
    let clockMs = NOW;
    const run = createExtendReservation({
      reservations: { extend: () => Promise.resolve(outcomes.shift() ?? mismatch(1)) },
      ledger,
      clock: { now: () => clockMs, date: () => new Date(clockMs) },
      logger: silentLogger,
      maxExtensions: 3,
    });

    await run(INPUT);
    clockMs = NOW + 5_000;
    await run(INPUT);
    await settle();

    const extendEntries = ledger.all().filter((entry) => entry.kind === 'extend');
    expect(extendEntries.map((entry) => [entry.sku, entry.sequence, entry.at.getTime()])).toEqual([
      ['KOLA-1L', 1, NOW],
      ['SUT-1L', 1, NOW],
    ]);
  });

  it('hic uzatilmamis kilitte (sayi 0) uyusmazlik deftere yazmaz', async () => {
    const { run, ledger } = setup(mismatch(0), () => Promise.resolve());

    expect((await run(INPUT)).extensionCount).toBe(0);
    await settle();

    expect(ledger.record).not.toHaveBeenCalled();
  });
});
