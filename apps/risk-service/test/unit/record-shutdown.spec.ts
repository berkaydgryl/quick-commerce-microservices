/**
 * Kapanis sirasi (#167): arka plandaki kayitlar ONCE (sinirli), Mongo EN SON;
 * bosaltma dusse de baglanti kapanir. Bosaltma suresi Mongo'nun islem
 * sinirindan, kapanis kancasi butcesiyle sinirli.
 */

import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { describe, expect, it } from 'vitest';

import {
  RISK_EVENT_DRAIN_DEFAULT_MS,
  RISK_STORE_CLOSE_RESERVE_MS,
} from '../../src/config/constants.js';
import { drainThenClose, recordDrainTimeoutMs } from '../../src/infrastructure/record-shutdown.js';

describe('drainThenClose', () => {
  it('once bosaltir, SONRA kapatir; birakilan varsa sayisi info gunlugunde', async () => {
    const calls: string[] = [];
    const lines: LogLine[] = [];

    await drainThenClose({
      pending: {
        drain: (timeoutMs) => {
          calls.push(`drain:${String(timeoutMs)}`);
          return Promise.resolve(2);
        },
      },
      timeoutMs: 1_500,
      close: () => {
        calls.push('close');
        return Promise.resolve();
      },
      logger: recordingLogger(lines),
    });

    expect(calls).toEqual(['drain:1500', 'close']);
    expect(lines).toEqual([
      expect.objectContaining({ level: 'info', fields: { abandoned: 2, timeoutMs: 1_500 } }),
    ]);
  });

  it('birakilan yoksa gunluk yok', async () => {
    const lines: LogLine[] = [];

    await drainThenClose({
      pending: { drain: () => Promise.resolve(0) },
      timeoutMs: 10,
      close: () => Promise.resolve(),
      logger: recordingLogger(lines),
    });

    expect(lines).toEqual([]);
  });

  it('bosaltma dusse de Mongo kapanir; hata cagirana doner', async () => {
    let closed = false;

    await expect(
      drainThenClose({
        pending: { drain: () => Promise.reject(new Error('beklenmedik')) },
        timeoutMs: 10,
        close: () => {
          closed = true;
          return Promise.resolve();
        },
        logger: recordingLogger([]),
      }),
    ).rejects.toThrow('beklenmedik');
    expect(closed).toBe(true);
  });
});

describe('recordDrainTimeoutMs', () => {
  const HOOK_MS = 10_000;
  const BUDGET_MS = HOOK_MS - RISK_STORE_CLOSE_RESERVE_MS;

  it.each([
    ['Mongo yok (MOCK)', undefined, RISK_EVENT_DRAIN_DEFAULT_MS],
    ['suresiz Mongo (0)', { operationTimeoutMs: 0 }, RISK_EVENT_DRAIN_DEFAULT_MS],
    ['uretim varsayilani 2 sn', { operationTimeoutMs: 2_000 }, 2_000],
    ['5 sn islem siniri', { operationTimeoutMs: 5_000 }, 5_000],
    ['60 sn: kanca butcesinden kapanis payi dusulur', { operationTimeoutMs: 60_000 }, BUDGET_MS],
  ])('%s', (_name, mongo, expected) => {
    expect(recordDrainTimeoutMs(mongo, HOOK_MS)).toBe(expected);
  });

  it('kanca butcesi degisirse ust sinir onunla gelir; pay butceyi asarsa 0', () => {
    expect(recordDrainTimeoutMs({ operationTimeoutMs: 60_000 }, 30_000)).toBe(
      30_000 - RISK_STORE_CLOSE_RESERVE_MS,
    );
    expect(recordDrainTimeoutMs({ operationTimeoutMs: 2_000 }, 1_000)).toBe(0);
  });
});
