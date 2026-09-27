/**
 * Outbox yayinci isci (T7.3): zamanlama ve kapanis. Sahte zamanlayicilar;
 * tur (relay) sahte.
 */

import { silentLogger } from '@getir/core';
import type { LogFields } from '@getir/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startOutboxPublisher } from '../../src/interfaces/workers/outbox-publisher.js';

const INTERVAL_MS = 500;
const BATCH = 100;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('startOutboxPublisher', () => {
  it('aralikla tur calistirir; tur bitmeden yenisi baslamaz', async () => {
    const relay = vi.fn(() => Promise.resolve(0));
    const worker = startOutboxPublisher({
      relay,
      intervalMs: INTERVAL_MS,
      batchSize: BATCH,
      logger: silentLogger,
    });

    expect(relay).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(relay).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(relay).toHaveBeenCalledTimes(2);

    await worker.stop();
  });

  it('uzun suren tur bitmeden YENISI BASLAMAZ; sonraki tur bittikten bir aralik sonra', async () => {
    let finish: (count: number) => void = () => undefined;
    const relay = vi
      .fn<() => Promise<number>>()
      .mockImplementationOnce(() => new Promise<number>((resolve) => (finish = resolve)))
      .mockResolvedValue(0);
    const worker = startOutboxPublisher({
      relay,
      intervalMs: INTERVAL_MS,
      batchSize: BATCH,
      logger: silentLogger,
    });

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
    // Ilk tur hala suruyor: setInterval olsaydi ucu daha baslamisti.
    expect(relay).toHaveBeenCalledTimes(1);

    finish(0);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS - 1);
    expect(relay).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(relay).toHaveBeenCalledTimes(2);

    await worker.stop();
  });

  it('tam dolu parti cikarsa beklemeden devam eder (kuyruk erir)', async () => {
    const relay = vi
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(BATCH)
      .mockResolvedValueOnce(BATCH)
      .mockResolvedValue(0);
    const worker = startOutboxPublisher({
      relay,
      intervalMs: INTERVAL_MS,
      batchSize: BATCH,
      logger: silentLogger,
    });

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    // Dolu partiden sonra 0 ms'lik bekleme: saat 1 ms ilerleyince sonraki tur.
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(relay).toHaveBeenCalledTimes(3);

    // Ucuncu tur bos: artik aralik kadar beklenir.
    await vi.advanceTimersByTimeAsync(INTERVAL_MS - 10);
    expect(relay).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(10);
    expect(relay).toHaveBeenCalledTimes(4);

    await worker.stop();
  });

  it('tur hata verirse isci durmaz, hata gunluge yazilir', async () => {
    const error = vi.fn<(fields: LogFields, message: string) => void>();
    const logger = { ...silentLogger, error, child: () => logger };
    const relay = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error('mongo kapali'))
      .mockResolvedValue(0);
    const worker = startOutboxPublisher({
      relay,
      intervalMs: INTERVAL_MS,
      batchSize: BATCH,
      logger,
    });

    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);

    expect(relay).toHaveBeenCalledTimes(2);
    const [fields] = error.mock.calls[0] ?? [];
    expect(fields).toMatchObject({ err: new Error('mongo kapali') });
    await worker.stop();
  });

  it('stop suren turu BEKLER ve yeni tur planlamaz', async () => {
    let finish: (count: number) => void = () => undefined;
    const relay = vi.fn(() => new Promise<number>((resolve) => (finish = resolve)));
    const worker = startOutboxPublisher({
      relay,
      intervalMs: INTERVAL_MS,
      batchSize: BATCH,
      logger: silentLogger,
    });
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    let stopped = false;
    const stopping = worker.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);

    finish(0);
    await stopping;
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);

    expect(stopped).toBe(true);
    expect(relay).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
