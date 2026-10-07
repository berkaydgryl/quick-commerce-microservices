/**
 * Uzatma use-case'i (T11.3, B21): depo sonucu -> cevap ya da hata, defter
 * kaydi (iz, best-effort). Depo sahte; iki deponun kurallari sozlesme
 * testinde, gercek Redis ve Mongo test/integration/'da.
 */

import { AppError, ERROR_CODES, fixedClock } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { createExtendReservation } from '../../src/application/extend-reservation.js';
import type { ExtendOutcome } from '../../src/domain/reservation.js';
import type { LedgerEntry } from '../../src/domain/stock-ledger.js';

const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);
const MARKET = 'mkt_migros-jet-moda';
const ORDER = 'ord_00000000000000000000000000000001';
const INPUT = { orderId: ORDER, marketId: MARKET, additionalSeconds: 60 };

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

const EXTENDED: ExtendOutcome = {
  status: 'extended',
  expiresAt: NOW + 120_000,
  extensionCount: 2,
  lines: [
    { sku: 'KOLA-1L', quantity: 1 },
    { sku: 'SUT-1L', quantity: 2 },
  ],
};

describe('ExtendReservation use-case (T11.3)', () => {
  it('depoya ms ve hak sayisiyla gider; uzatilinca kalem basina SIRALI defter kaydi, INFO', async () => {
    const { run, extend, ledger, lines } = setup(EXTENDED, () => Promise.resolve());

    expect(await run(INPUT)).toEqual({
      expiresAt: new Date(NOW + 120_000),
      alreadyExtended: false,
      extensionCount: 2,
      expiryMismatch: false,
    });
    expect(extend).toHaveBeenCalledWith({
      orderId: ORDER,
      marketId: MARKET,
      nowMs: NOW,
      additionalMs: 60_000,
      maxExtensions: 3,
    });
    expect(ledger.record).toHaveBeenCalledWith([
      expect.objectContaining({ sku: 'KOLA-1L', kind: 'extend', delta: 0, sequence: 2 }),
      expect.objectContaining({ sku: 'SUT-1L', kind: 'extend', delta: 0, sequence: 2 }),
    ]);
    expect(lines.map((line) => [line.level, line.message])).toEqual([
      ['info', 'rezervasyon uzatildi'],
    ]);
  });

  it('defter yazilamazsa uzatma GECERLI kalir (hak bosa yanmaz); UYARI yazilir', async () => {
    const { run, lines } = setup(EXTENDED, () => Promise.reject(new Error('mongo kapali')));

    expect((await run(INPUT)).alreadyExtended).toBe(false);
    expect(lines.find((line) => line.level === 'warn')?.message).toBe(
      'uzatma defter kaydi yazilamadi; uzatma gecerli',
    );
  });

  it('hak bitmisse sure ayni, alreadyExtended; deftere yazilmaz', async () => {
    const { run, ledger } = setup(
      { status: 'limit-reached', expiresAt: NOW + 30_000, extensionCount: 3 },
      () => Promise.resolve(),
    );

    expect(await run(INPUT)).toEqual({
      expiresAt: new Date(NOW + 30_000),
      alreadyExtended: true,
      extensionCount: 3,
      expiryMismatch: false,
    });
    expect(ledger.record).not.toHaveBeenCalled();
  });

  it.each(['settled', 'absent', 'orphaned', 'due'] as const)(
    'aktif rezervasyon yoksa (%s) RESERVATION_EXPIRED; deftere yazilmaz',
    async (reason) => {
      const { run, ledger } = setup({ status: 'inactive', reason }, () => Promise.resolve());

      const error: unknown = await run(INPUT).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        code: ERROR_CODES.RESERVATION_EXPIRED,
        details: { orderId: ORDER, marketId: MARKET, reason },
      });
      expect(ledger.record).not.toHaveBeenCalled();
    },
  );
});
