/**
 * Kisaltma use-case'i (T11.3): depo sonucu -> cevap ya da hata. Depo sahte;
 * kurallar sozlesme testinde, gercek Redis test/integration/'da.
 */

import { ERROR_CODES, fixedClock } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { createShortenReservation } from '../../src/application/shorten-reservation.js';
import type { ShortenOutcome } from '../../src/domain/reservation.js';

const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);
const MARKET = 'mkt_migros-jet-moda';
const ORDER = 'ord_00000000000000000000000000000001';
const INPUT = { orderId: ORDER, marketId: MARKET, maxRemainingSeconds: 120 };

function setup(outcome: ShortenOutcome) {
  const lines: LogLine[] = [];
  const shorten = vi.fn(() => Promise.resolve(outcome));
  const run = createShortenReservation({
    reservations: { shorten },
    clock: fixedClock(NOW),
    logger: recordingLogger(lines),
  });
  return { run, shorten, lines };
}

describe('ShortenReservation use-case (T11.3)', () => {
  it('depoya ms olarak gider; kisaltilinca yeni bitis ve INFO', async () => {
    const { run, shorten, lines } = setup({ status: 'shortened', expiresAt: NOW + 120_000 });

    expect(await run(INPUT)).toEqual({ expiresAt: new Date(NOW + 120_000), shortened: true });
    expect(shorten).toHaveBeenCalledWith({
      orderId: ORDER,
      marketId: MARKET,
      nowMs: NOW,
      maxRemainingMs: 120_000,
    });
    expect(lines.map((line) => line.message)).toEqual(['rezervasyon kisaltildi']);
  });

  it('kalan sure zaten kisaysa shortened=false, mevcut bitis; gunluk yok', async () => {
    const { run, lines } = setup({ status: 'unchanged', expiresAt: NOW + 30_000 });

    expect(await run(INPUT)).toEqual({ expiresAt: new Date(NOW + 30_000), shortened: false });
    expect(lines).toEqual([]);
  });

  it('aktif rezervasyon yoksa RESERVATION_EXPIRED', async () => {
    const { run } = setup({ status: 'inactive', reason: 'due' });

    await expect(run(INPUT)).rejects.toMatchObject({
      code: ERROR_CODES.RESERVATION_EXPIRED,
      details: { reason: 'due' },
    });
  });
});
