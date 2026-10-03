import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runShutdown } from '../../src/interfaces/shutdown.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('runShutdown', () => {
  it('adimlari sirayla calistirir', async () => {
    const order: string[] = [];
    const step = (name: string) => ({
      name,
      timeoutMs: 1_000,
      run: () => {
        order.push(name);
        return Promise.resolve();
      },
    });

    await runShutdown([step('socket.io'), step('redis'), step('izler')], recordingLogger([]));

    expect(order).toEqual(['socket.io', 'redis', 'izler']);
  });

  it('hata veren adim gunluge yazilir, siradakiler yine calisir', async () => {
    const lines: LogLine[] = [];
    const later = vi.fn(() => Promise.resolve());

    await runShutdown(
      [
        { name: 'redis', timeoutMs: 1_000, run: () => Promise.reject(new Error('baglanti koptu')) },
        { name: 'izler', timeoutMs: 1_000, run: later },
      ],
      recordingLogger(lines),
    );

    expect(later).toHaveBeenCalledOnce();
    expect(lines).toEqual([
      expect.objectContaining({
        level: 'error',
        message: 'kapanis adimi hata verdi',
        fields: expect.objectContaining({ step: 'redis' }) as unknown,
      }),
    ]);
  });

  it('suresinde bitmeyen adim beklenmez', async () => {
    vi.useFakeTimers();
    const lines: LogLine[] = [];
    const later = vi.fn(() => Promise.resolve());

    const done = runShutdown(
      [
        { name: 'socket.io', timeoutMs: 500, run: () => new Promise<void>(() => undefined) },
        { name: 'izler', timeoutMs: 500, run: later },
      ],
      recordingLogger(lines),
    );
    await vi.advanceTimersByTimeAsync(500);
    await done;

    expect(later).toHaveBeenCalledOnce();
    expect(lines).toEqual([
      {
        level: 'error',
        message: 'kapanis adimi suresinde bitmedi; beklenmiyor',
        fields: { step: 'socket.io', timeoutMs: 500 },
      },
    ]);
  });
});
