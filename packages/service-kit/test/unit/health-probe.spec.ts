/**
 * Saglik yoklamasi: gercek sunucu, gercek istemci, dis bagimlilik yok.
 */

import { status as GrpcStatus } from '@grpc/grpc-js';
import type { ServiceError } from '@grpc/grpc-js';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createEchoImplementation,
  echoServiceDefinition,
  ECHO_SERVICE_NAME,
} from '../../src/example/echo-service.js';
import { probeHealth } from '../../src/grpc/health-probe.js';
import { startGrpcServer } from '../../src/grpc/server.js';
import type { GrpcServerHandle } from '../../src/grpc/types.js';
import { unimplemented } from '../../src/grpc/unimplemented.js';

const EPHEMERAL_PORT = 0;
/** Yanit vermeyen port icin kisa sure: test beklemesin. */
const SHORT_TIMEOUT_MS = 300;

let handle: GrpcServerHandle | undefined;

afterEach(async () => {
  await handle?.shutdown('test bitti');
  handle = undefined;
});

async function start(): Promise<GrpcServerHandle> {
  handle = await startGrpcServer({
    serviceName: 'probe-test',
    host: '127.0.0.1',
    port: EPHEMERAL_PORT,
    services: [
      {
        name: ECHO_SERVICE_NAME,
        definition: echoServiceDefinition,
        implementation: createEchoImplementation('t'),
      },
    ],
  });
  return handle;
}

describe('probeHealth', () => {
  it('SERVING sunucuda true', async () => {
    const server = await start();

    await expect(probeHealth({ port: server.port })).resolves.toBe(true);
  });

  it('kapanmis sunucuda false', async () => {
    const server = await start();
    const { port } = server;
    await server.shutdown('yoklama testi');
    handle = undefined;

    await expect(probeHealth({ port, timeoutMs: SHORT_TIMEOUT_MS })).resolves.toBe(false);
  });

  it('dinleyen sunucu yoksa zaman asimi icinde false', async () => {
    const startedAt = Date.now();

    // 1 numarali port ayricalikli ve bos: baglanti reddedilir ya da zaman asimi.
    await expect(probeHealth({ port: 1, timeoutMs: SHORT_TIMEOUT_MS })).resolves.toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(SHORT_TIMEOUT_MS * 5);
  });
});

describe('unimplemented', () => {
  it('UNIMPLEMENTED doner, mesaj metodu ve gorevi soyler', async () => {
    const error = await new Promise<ServiceError | null>((resolve) => {
      unimplemented('GetProduct', 'T4.5')(
        {} as Parameters<ReturnType<typeof unimplemented>>[0],
        (serviceError) => resolve(serviceError as ServiceError | null),
      );
    });

    expect(error?.code).toBe(GrpcStatus.UNIMPLEMENTED);
    expect(error?.details).toBe('GetProduct henuz uygulanmadi (T4.5)');
  });
});
