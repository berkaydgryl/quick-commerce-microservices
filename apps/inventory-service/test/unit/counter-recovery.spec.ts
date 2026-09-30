/**
 * Redis bosalinca sayaclarin kendiliginden yeniden kurulmasi (T10.1 PR 2,
 * bekleyen #36; ADR-17). Isaret ve seed sahte; gercek Redis ve Mongo ile
 * test/integration/stock-stores.spec.ts'te.
 */

import { AppError, ERROR_CODES } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { createCounterRecovery } from '../../src/application/counter-recovery.js';
import type { SeedCountersResult } from '../../src/application/seed-counters.js';
import type { CounterSetMarker } from '../../src/domain/stock.js';

const RESULT: SeedCountersResult = { scanned: 71, written: 71 };
const TIMEOUT_MS = 50;

/** Isaret: seed bitince konur (gercek seed-counters gibi). */
function setup(options: { present: boolean; reseed?: () => Promise<SeedCountersResult> }) {
  let present = options.present;
  const marker: CounterSetMarker = {
    isPresent: () => Promise.resolve(present),
    markPresent: () => {
      present = true;
      return Promise.resolve();
    },
  };
  const reseed = vi.fn(
    options.reseed ??
      (async () => {
        await marker.markPresent();
        return RESULT;
      }),
  );
  const lines: LogLine[] = [];
  const recover = createCounterRecovery({
    marker,
    reseed,
    logger: recordingLogger(lines),
    timeoutMs: TIMEOUT_MS,
  });
  return { recover, reseed, lines, drop: () => (present = false) };
}

async function errorOf(promise: Promise<unknown>): Promise<AppError> {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof AppError)) throw new Error('AppError bekleniyordu');
  return error;
}

describe('createCounterRecovery', () => {
  it('isaret yerinde: Redis bosalmamis, SKU gercekten yok -> false; Mongo ya gidilmez', async () => {
    const { recover, reseed, lines } = setup({ present: true });

    expect(await recover()).toBe(false);
    expect(reseed).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
  });

  it('isaret yok: sayaclar yeniden kurulur -> true; bir uyari ve bir bilgi satiri', async () => {
    const { recover, reseed, lines } = setup({ present: false });

    expect(await recover()).toBe(true);
    expect(reseed).toHaveBeenCalledOnce();
    expect(lines.map((line) => line.level)).toEqual(['warn', 'info']);
    expect(lines[1]?.fields).toMatchObject(RESULT);
  });

  it('tek ucus: ayni anda gelen 5 istek TEK kurulumu bekler', async () => {
    let finish: () => void = () => undefined;
    const { recover, reseed } = setup({
      present: false,
      reseed: () =>
        new Promise((resolve) => {
          finish = () => resolve(RESULT);
        }),
    });

    const waiting = Array.from({ length: 5 }, () => recover());
    await vi.waitFor(() => expect(reseed).toHaveBeenCalledOnce());
    finish();

    expect(await Promise.all(waiting)).toEqual([true, true, true, true, true]);
    expect(reseed).toHaveBeenCalledOnce();
  });

  it('kurulum duserse SERVICE_UNAVAILABLE (tekrar denenebilir); sonraki istek yeniden dener', async () => {
    const { recover, reseed, lines } = setup({
      present: false,
      reseed: () => Promise.reject(new Error('mongo kapali')),
    });

    const error = await errorOf(recover());

    expect(error.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
    expect(lines.map((line) => line.level)).toEqual(['warn', 'error']);
    await errorOf(recover());
    expect(reseed).toHaveBeenCalledTimes(2);
  });

  it('sure asiminda istek SERVICE_UNAVAILABLE alir; kurulum arka planda surer, ikinci kez baslamaz', async () => {
    let finish: () => void = () => undefined;
    const { recover, reseed } = setup({
      present: false,
      reseed: () =>
        new Promise((resolve) => {
          finish = () => resolve(RESULT);
        }),
    });

    const first = await errorOf(recover());
    expect(first.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
    expect(first.details).toEqual({ timeoutMs: TIMEOUT_MS });

    const second = recover();
    finish();

    expect(await second).toBe(true);
    expect(reseed).toHaveBeenCalledOnce();
  });

  it('kurulumdan sonra isaret yeniden duserse (Redis bir daha bosaldi) tekrar kurulur', async () => {
    const { recover, reseed, drop } = setup({ present: false });

    await recover();
    drop();
    await recover();

    expect(reseed).toHaveBeenCalledTimes(2);
  });
});
