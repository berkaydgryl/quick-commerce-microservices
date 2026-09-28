/**
 * unimplemented() (D5): yazilmamis uc diger hatalarla ayni yoldan doner -
 * gRPC UNIMPLEMENTED, x-app-error'da NOT_IMPLEMENTED (HTTP 501) ve mesaj,
 * x-request-id, WARN gunluk satiri.
 */

import { ERROR_CODES, GRPC_STATUS } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { Metadata } from '@grpc/grpc-js';
import { afterEach, describe, expect, it } from 'vitest';

import { REQUEST_ID_METADATA_KEY } from '../../src/config/constants.js';
import { echoServiceDefinition } from '../../src/example/echo-service.js';
import { unimplemented } from '../../src/grpc/unimplemented.js';
import { appErrorPayloadOf, startTestGrpcServer } from '../../src/testing/index.js';
import type { TestGrpcServer } from '../../src/testing/index.js';
import { callByName } from './support/grpc-client.js';

let server: TestGrpcServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

async function serveUnimplementedEcho(lines: LogLine[]): Promise<TestGrpcServer> {
  server = await startTestGrpcServer({
    services: [
      {
        definition: echoServiceDefinition,
        implementation: {
          Echo: unimplemented('Echo', 'T9.9', recordingLogger(lines, { service: 'echo' })),
        },
      },
    ],
  });
  return server;
}

describe('unimplemented', () => {
  it('UNIMPLEMENTED + x-app-error NOT_IMPLEMENTED; mesaj gorevi soyler; requestId tasinir', async () => {
    const { client } = await serveUnimplementedEcho([]);
    const metadata = new Metadata();
    metadata.set(REQUEST_ID_METADATA_KEY, 'req_yok');

    const { error } = await callByName(
      client,
      echoServiceDefinition,
      'Echo',
      { message: 'x', repeat: 1 },
      metadata,
    );

    expect(error?.code).toBe(GRPC_STATUS.UNIMPLEMENTED);
    // Standart gRPC alani da ayni mesaji tasir (Go istemcisi yuku okumasa bile).
    expect(error?.details).toBe('Echo henuz uygulanmadi (T9.9)');
    expect(appErrorPayloadOf(error)).toEqual({
      code: ERROR_CODES.NOT_IMPLEMENTED,
      message: 'Echo henuz uygulanmadi (T9.9)',
      requestId: 'req_yok',
    });
    expect(error?.metadata.get(REQUEST_ID_METADATA_KEY)).toEqual(['req_yok']);
  });

  it('cagri WARN olarak yazilir (beklenen is hatasi gibi, gurultu degil)', async () => {
    const lines: LogLine[] = [];
    const { client } = await serveUnimplementedEcho(lines);

    await callByName(client, echoServiceDefinition, 'Echo', { message: 'x', repeat: 1 });

    expect(lines).toEqual([
      expect.objectContaining({
        level: 'warn',
        message: 'rpc is hatasiyla dondu',
        fields: expect.objectContaining({
          rpc: 'Echo',
          code: ERROR_CODES.NOT_IMPLEMENTED,
        }) as unknown,
      }),
    ]);
  });
});
