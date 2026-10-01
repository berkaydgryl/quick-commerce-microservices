/**
 * Zarif kapanisin test edilmemis yollari (D5): sure asiminda zorla kapanis,
 * kapanis kancasinin hatasi ve iptal edilen Watch akisinin aboneligi.
 * Gercek sunucu + gercek istemci, yalnizca localhost.
 */

import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SERVING_STATUS } from '../../src/config/constants.js';
import { echoServiceDefinition } from '../../src/example/echo-service.js';
import { healthServiceDefinition } from '../../src/grpc/health.js';
import { startTestGrpcServer } from '../../src/testing/index.js';
import type { TestGrpcServer } from '../../src/testing/index.js';
import { callByName, firstMessage, streamCall } from './support/grpc-client.js';

/** Zorla kapanis testi icin kisa bekleme; uretimde GRPC_SHUTDOWN_TIMEOUT_MS. */
const SHORT_SHUTDOWN_MS = 100;

const started: TestGrpcServer[] = [];

afterEach(async () => {
  await Promise.all(started.splice(0).map((server) => server.stop('test bitti')));
});

async function start(options: Parameters<typeof startTestGrpcServer>[0]): Promise<TestGrpcServer> {
  const server = await startTestGrpcServer(options);
  started.push(server);
  return server;
}

function waitUntil(check: () => boolean): Promise<void> {
  return vi.waitFor(() => {
    if (!check()) {
      throw new Error('henuz degil');
    }
  });
}

describe('zarif kapanis: sure asimi ve hata yollari', () => {
  it('bitmeyen cagri sure asiminda zorla kesilir; kapanis yine biter', async () => {
    const lines: LogLine[] = [];
    let reachedServer = false;
    const server = await start({
      logger: recordingLogger(lines),
      shutdownTimeoutMs: SHORT_SHUTDOWN_MS,
      services: [
        {
          definition: echoServiceDefinition,
          // Hic cevap vermeyen handler: takilmis bir veritabani cagrisi gibi.
          implementation: {
            Echo: (): void => {
              reachedServer = true;
            },
          },
        },
      ],
    });
    const pending = callByName(server.client, echoServiceDefinition, 'Echo', {
      message: 'asili',
      repeat: 1,
    });
    await waitUntil(() => reachedServer);

    await server.handle.shutdown('test');

    expect(lines).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        message: 'devam eden cagrilar bitmedi, sunucu zorla kapatiliyor',
      }),
    );
    expect(lines.at(-1)).toMatchObject({
      message: 'zarif kapanis bitti',
      fields: { forced: true },
    });
    const result = await pending;
    expect(result.error).toBeDefined();
    expect(result.response).toBeUndefined();
  });

  it('kapanis kancasi hata firlatsa da kapanis tamamlanir, hata ERROR yazilir', async () => {
    const lines: LogLine[] = [];
    const server = await start({
      logger: recordingLogger(lines),
      services: [],
      onShutdown: () => {
        throw new Error('mongo kapanmadi');
      },
    });

    await expect(server.handle.shutdown('test')).resolves.toBeUndefined();

    expect(lines).toContainEqual(
      expect.objectContaining({ level: 'error', message: 'kapanis kancasi hata verdi' }),
    );
    expect(lines.at(-1)).toMatchObject({
      message: 'zarif kapanis bitti',
      fields: { hook: 'failed' },
    });
  });

  it('kanca suresinde bitmezse beklenmez: kapanis biter, ERROR yazilir (#56)', async () => {
    const lines: LogLine[] = [];
    const server = await start({
      logger: recordingLogger(lines),
      services: [],
      shutdownHookTimeoutMs: SHORT_SHUTDOWN_MS,
      // Takilmis Mongo kapanisi ya da isci turu: hic bitmeyen kanca.
      onShutdown: () => new Promise<void>(() => undefined),
    });

    await expect(server.handle.shutdown('test')).resolves.toBeUndefined();

    expect(lines).toContainEqual(
      expect.objectContaining({
        level: 'error',
        message: 'kapanis kancasi suresinde bitmedi; beklenmiyor',
        fields: expect.objectContaining({ hookTimeoutMs: SHORT_SHUTDOWN_MS }) as unknown,
      }),
    );
    expect(lines.at(-1)).toMatchObject({
      message: 'zarif kapanis bitti',
      fields: { hook: 'timed-out' },
    });
  });

  it('metrik ucu drenajdan sonra, kancadan ONCE kapanir (T10.5)', async () => {
    let metricsAtHook: 'acik' | 'kapali' | undefined;
    const holder: { port?: number } = {};
    const server = await start({
      services: [],
      onShutdown: async () => {
        metricsAtHook = await fetch(`http://127.0.0.1:${String(holder.port)}/metrics`).then(
          () => 'acik' as const,
          () => 'kapali' as const,
        );
      },
    });
    holder.port = server.handle.metricsPort;
    expect((await fetch(`http://127.0.0.1:${server.handle.metricsPort}/metrics`)).status).toBe(200);

    await server.handle.shutdown('test');

    expect(metricsAtHook).toBe('kapali');
  });
});

describe('Health Watch aboneligi', () => {
  it('istemci akisi iptal edince abonelik birakilir (sizinti yok)', async () => {
    const server = await start({ services: [] });
    const registry = server.handle.health;
    const subscribe = registry.subscribe.bind(registry);
    const released = vi.fn();
    vi.spyOn(registry, 'subscribe').mockImplementation((service, listener) => {
      const unsubscribe = subscribe(service, listener);
      return () => {
        released();
        unsubscribe();
      };
    });
    const stream = streamCall<{ service: string }, { status: string }>(
      server.client,
      healthServiceDefinition,
      'Watch',
      { service: '' },
    );
    expect((await firstMessage(stream)).status).toBe(SERVING_STATUS.SERVING);
    // Iptal istemci tarafinda CANCELLED hatasi uretir; beklenen, yut.
    stream.on('error', () => undefined);

    stream.cancel();

    await waitUntil(() => released.mock.calls.length > 0);
  });
});
