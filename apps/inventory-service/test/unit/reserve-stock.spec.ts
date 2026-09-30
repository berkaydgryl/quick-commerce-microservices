/**
 * Reserve use-case'i (T10.1): deponun sonucu -> cevap ya da sozlesmedeki hata.
 * Depo sahte (sonuc verilir); kurallarin depodaki karsiligi sozlesme testinde.
 */

import { AppError, ERROR_CODES, fixedClock } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { createReserveStock } from '../../src/application/reserve-stock.js';
import type { ReserveCommand, ReserveOutcome } from '../../src/domain/reservation.js';

const NOW = Date.UTC(2026, 8, 30, 12, 0, 0);
const INPUT = {
  orderId: 'ord_00000000000000000000000000000001',
  marketId: 'mkt_migros-jet-moda',
  userId: 'usr_00000000000000000000000000000001',
  items: [{ sku: 'SUT-1L', quantity: 2 }],
  ttlSeconds: 120,
};

function useCase(outcome: ReserveOutcome, ...later: ReserveOutcome[]) {
  const commands: ReserveCommand[] = [];
  const lines: LogLine[] = [];
  const outcomes = [outcome, ...later];
  const recoverCounters = vi.fn(() => Promise.resolve(false));
  const reserveStock = createReserveStock({
    reservations: {
      reserve: (command) => {
        commands.push(command);
        return Promise.resolve(outcomes[Math.min(commands.length, outcomes.length) - 1] ?? outcome);
      },
    },
    recoverCounters,
    clock: fixedClock(NOW),
    logger: recordingLogger(lines),
  });
  return { reserveStock, commands, lines, recoverCounters };
}

async function errorOf(promise: Promise<unknown>): Promise<AppError> {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof AppError)) throw new Error('AppError bekleniyordu');
  return error;
}

describe('reserveStock', () => {
  it('depoya "simdi" servisin saatinden, sure milisaniyeye cevrilerek gider', async () => {
    const { reserveStock, commands } = useCase({ status: 'reserved', expiresAt: NOW + 120_000 });

    await reserveStock(INPUT);

    expect(commands).toEqual([
      {
        orderId: INPUT.orderId,
        marketId: INPUT.marketId,
        userId: INPUT.userId,
        lines: INPUT.items,
        nowMs: NOW,
        ttlMs: 120_000,
      },
    ]);
  });

  it('rezerve: bitis ani Date, alreadyReserved false', async () => {
    const { reserveStock } = useCase({ status: 'reserved', expiresAt: NOW + 120_000 });

    expect(await reserveStock(INPUT)).toEqual({
      expiresAt: new Date(NOW + 120_000),
      alreadyReserved: false,
    });
  });

  it('ayni siparis: ilk bitis ani, alreadyReserved true (hata degil)', async () => {
    const { reserveStock } = useCase({ status: 'already-reserved', expiresAt: NOW - 5_000 });

    expect(await reserveStock(INPUT)).toEqual({
      expiresAt: new Date(NOW - 5_000),
      alreadyReserved: true,
    });
  });

  it('yetersiz: STOCK_INSUFFICIENT, ayrintida sku, istenen ve mevcut', async () => {
    const { reserveStock, lines } = useCase({
      status: 'insufficient',
      sku: 'SUT-1L',
      requested: 2,
      counter: 1,
      counterMissing: false,
    });

    const error = await errorOf(reserveStock(INPUT));

    expect(error.code).toBe(ERROR_CODES.STOCK_INSUFFICIENT);
    expect(error.details).toEqual({ sku: 'SUT-1L', requested: 2, available: 1 });
    expect(lines).toEqual([]);
  });

  it('sayaci olmayan SKU (#36): mevcut 0, ayrintida counterMissing ve UYARI gunlugu', async () => {
    const { reserveStock, lines } = useCase({
      status: 'insufficient',
      sku: 'YOK-1',
      requested: 1,
      counter: 0,
      counterMissing: true,
    });

    const error = await errorOf(reserveStock(INPUT));

    expect(error.details).toEqual({
      sku: 'YOK-1',
      requested: 1,
      available: 0,
      counterMissing: true,
    });
    expect(lines).toMatchObject([
      { level: 'warn', fields: { marketId: INPUT.marketId, sku: 'YOK-1', orderId: INPUT.orderId } },
    ]);
  });

  it('negatif sayac: mevcut 0 bildirilir, gizlenmez (UYARI)', async () => {
    const { reserveStock, lines } = useCase({
      status: 'insufficient',
      sku: 'SUT-1L',
      requested: 1,
      counter: -3,
      counterMissing: false,
    });

    const error = await errorOf(reserveStock(INPUT));

    expect(error.details).toEqual({ sku: 'SUT-1L', requested: 1, available: 0 });
    expect(lines).toMatchObject([{ level: 'warn', fields: { counter: -3 } }]);
  });

  it('kullanicinin aktif rezervasyonu: RESERVATION_ACTIVE, ayrintida o siparis', async () => {
    const active = 'ord_00000000000000000000000000000009';
    const { reserveStock } = useCase({ status: 'user-has-active', activeOrderId: active });

    const error = await errorOf(reserveStock(INPUT));

    expect(error.code).toBe(ERROR_CODES.RESERVATION_ACTIVE);
    expect(error.details).toEqual({ activeOrderId: active });
  });
});

describe('reserveStock: Redis bosalinca (T10.1 PR 2, ADR-17)', () => {
  const missing: ReserveOutcome = {
    status: 'insufficient',
    sku: 'SUT-1L',
    requested: 2,
    counter: 0,
    counterMissing: true,
  };

  it('sayac yok + kume yeniden kuruldu: rezervasyon AYNI komutla bir kez tekrarlanir', async () => {
    const { reserveStock, commands, recoverCounters } = useCase(missing, {
      status: 'reserved',
      expiresAt: NOW + 120_000,
    });
    recoverCounters.mockResolvedValueOnce(true);

    expect(await reserveStock(INPUT)).toEqual({
      expiresAt: new Date(NOW + 120_000),
      alreadyReserved: false,
    });
    expect(commands).toHaveLength(2);
    expect(commands[1]).toEqual(commands[0]);
  });

  it('Redis bosalmamissa tekrar yok: sayaci gercekten olmayan SKU yetersiz (counterMissing)', async () => {
    const { reserveStock, commands, recoverCounters } = useCase(missing);

    const error = await errorOf(reserveStock(INPUT));

    expect(recoverCounters).toHaveBeenCalledOnce();
    expect(commands).toHaveLength(1);
    expect(error.details).toMatchObject({ counterMissing: true });
  });

  it('sayac VAR ama yetmiyor: kurtarma sorulmaz', async () => {
    const { reserveStock, recoverCounters } = useCase({
      status: 'insufficient',
      sku: 'SUT-1L',
      requested: 2,
      counter: 1,
      counterMissing: false,
    });

    await errorOf(reserveStock(INPUT));

    expect(recoverCounters).not.toHaveBeenCalled();
  });
});
