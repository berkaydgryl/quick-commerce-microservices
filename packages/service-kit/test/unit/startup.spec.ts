import { silentLogger } from '@getir/core';
import type { Logger } from '@getir/core';
import { describe, expect, it, vi } from 'vitest';

import { FATAL_EXIT_CODE } from '../../src/shutdown.js';
import { startOrExit } from '../../src/startup.js';

/** Yalnizca fatal cagrilarini kaydeden gunlukcu. */
function fatalRecorder(): { logger: Logger; fatal: ReturnType<typeof vi.fn> } {
  const fatal = vi.fn();
  const logger: Logger = { ...silentLogger, fatal, child: () => logger };
  return { logger, fatal };
}

describe('startOrExit', () => {
  it('acilis basariliysa sonucu doner; gunluk ve cikis yok', async () => {
    const { logger, fatal } = fatalRecorder();
    const exit = vi.fn();

    await expect(
      startOrExit(() => Promise.resolve({ port: 50051 }), { logger, exit }),
    ).resolves.toEqual({
      port: 50051,
    });

    expect(fatal).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it('acilis hatasi fatal gunluge hata nesnesiyle yazilir ve 1 koduyla cikilir', async () => {
    const { logger, fatal } = fatalRecorder();
    const exit = vi.fn();
    const cause = new Error('mongo ulasilamiyor');

    // Enjekte edilen exit geri doner; akis devam etmesin diye hata yeniden firlar.
    await expect(startOrExit(() => Promise.reject(cause), { logger, exit })).rejects.toBe(cause);

    expect(fatal).toHaveBeenCalledWith({ err: cause }, 'servis acilamadi');
    expect(exit).toHaveBeenCalledWith(FATAL_EXIT_CODE);
  });

  it('gunluk cikistan ONCE yazilir', async () => {
    const order: string[] = [];
    const logger: Logger = {
      ...silentLogger,
      fatal: () => {
        order.push('fatal');
      },
      child: () => logger,
    };

    await startOrExit(() => Promise.reject(new Error('port dolu')), {
      logger,
      exit: () => {
        order.push('exit');
      },
    }).catch(() => undefined);

    expect(order).toEqual(['fatal', 'exit']);
  });

  it('servis olmayan arac kendi mesajini verebilir', async () => {
    const { logger, fatal } = fatalRecorder();
    const cause = new Error('mongo yok');

    await startOrExit(() => Promise.reject(cause), {
      logger,
      message: 'seed baglantisi kurulamadi',
      exit: vi.fn(),
    }).catch(() => undefined);

    expect(fatal).toHaveBeenCalledWith({ err: cause }, 'seed baglantisi kurulamadi');
  });
});
