import { describe, expect, it, vi } from 'vitest';

import { installProcessHandlers, SHUTDOWN_SIGNALS } from '../../src/shutdown.js';

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
