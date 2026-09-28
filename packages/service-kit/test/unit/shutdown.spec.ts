import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { FATAL_EXIT_CODE, installProcessHandlers, SHUTDOWN_SIGNALS } from '../../src/shutdown.js';

/**
 * Testte GERCEK sinyal gonderilmez: process.emit dinleyicileri dogrudan cagirir.
 * SIGUSR2 secildi cunku SIGINT/SIGTERM'i test kosucusu da dinliyor olabilir.
 */
const TEST_SIGNAL: NodeJS.Signals = 'SIGUSR2';

describe('installProcessHandlers', () => {
  it('sinyalde zarif kapanisi cagirir ve sifir kodla cikar', async () => {
    const shutdown = vi.fn(() => Promise.resolve());
    const exit = vi.fn();
    const uninstall = installProcessHandlers({
      shutdown,
      exit,
      signals: [TEST_SIGNAL],
    });

    // Node, sinyal dinleyicisini sinyal adiyla cagirir; emit de ayni sekilde.
    process.emit(TEST_SIGNAL, TEST_SIGNAL);
    // Kapanis asenkron; sozun cozulmesini bekle.
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));

    expect(shutdown).toHaveBeenCalledWith(TEST_SIGNAL);
    uninstall();
  });

  it('kapanis hata verse bile process cikar', async () => {
    const shutdown = vi.fn(() => Promise.reject(new Error('kapanis bozuk')));
    const exit = vi.fn();
    const uninstall = installProcessHandlers({ shutdown, exit, signals: [TEST_SIGNAL] });

    // Node, sinyal dinleyicisini sinyal adiyla cagirir; emit de ayni sekilde.
    process.emit(TEST_SIGNAL, TEST_SIGNAL);
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));

    uninstall();
  });

  it('uninstall dinleyicileri geri alir', () => {
    const before = process.listenerCount(TEST_SIGNAL);
    const uninstall = installProcessHandlers({
      shutdown: () => Promise.resolve(),
      exit: () => undefined,
      signals: [TEST_SIGNAL],
    });

    expect(process.listenerCount(TEST_SIGNAL)).toBe(before + 1);
    uninstall();
    expect(process.listenerCount(TEST_SIGNAL)).toBe(before);
  });

  it('varsayilan sinyaller SIGINT ve SIGTERM', () => {
    expect(SHUTDOWN_SIGNALS).toEqual(['SIGINT', 'SIGTERM']);
  });
});

/**
 * Yakalanmamis hata (D5). Test kosucusu da bu olaylari dinler: elle yayilan
 * olayi "testte yakalanmamis hata" sanmasin diye onun dinleyicileri test
 * boyunca kenara alinir ve sonra geri takilir.
 */
type FatalEvent = 'uncaughtException' | 'unhandledRejection';

async function withoutRunnerListeners(event: FatalEvent, run: () => Promise<void>): Promise<void> {
  // Genel EventEmitter yuzu: iki olayin ayri ayri tipli asiri yuklemeleri birlesemiyor.
  const emitter: NodeJS.EventEmitter = process;
  const saved = emitter.listeners(event) as ((...args: unknown[]) => void)[];
  emitter.removeAllListeners(event);
  try {
    await run();
  } finally {
    for (const listener of saved) {
      emitter.on(event, listener);
    }
  }
}

describe('installProcessHandlers: yakalanmamis hata', () => {
  it.each<[FatalEvent, () => void]>([
    ['uncaughtException', () => process.emit('uncaughtException', new Error('beklenmeyen'))],
    [
      'unhandledRejection',
      () => process.emit('unhandledRejection', new Error('reddedildi'), Promise.resolve()),
    ],
  ])('%s: FATAL yazilir, kapanis denenir, cikis kodu 1', async (kind, emit) => {
    await withoutRunnerListeners(kind, async () => {
      const lines: LogLine[] = [];
      const shutdown = vi.fn(() => Promise.resolve());
      const exit = vi.fn();
      const uninstall = installProcessHandlers({
        shutdown,
        exit,
        signals: [],
        logger: recordingLogger(lines),
      });
      try {
        emit();

        await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(FATAL_EXIT_CODE));
        expect(shutdown).toHaveBeenCalledWith(kind);
        expect(lines[0]).toMatchObject({ level: 'fatal', fields: { kind } });
      } finally {
        uninstall();
      }
    });
  });

  it('kapanis da basarisiz olsa cikis kodu yine 1', async () => {
    await withoutRunnerListeners('uncaughtException', async () => {
      const exit = vi.fn();
      const uninstall = installProcessHandlers({
        shutdown: () => Promise.reject(new Error('kapanis bozuk')),
        exit,
        signals: [],
      });
      try {
        process.emit('uncaughtException', new Error('beklenmeyen'));

        await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(FATAL_EXIT_CODE));
      } finally {
        uninstall();
      }
    });
  });
});
