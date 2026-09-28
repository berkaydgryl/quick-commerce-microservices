/**
 * @getir/service-kit/testing (D5): x-app-error okuyuculari ve test sunucusu.
 * Okuyucular uretim cozucusunden (status.ts) BAGIMSIZDIR; burada kendi
 * sinirlari sinanir.
 */

import { AppError, ERROR_CODES } from '@getir/core';
import { Metadata } from '@grpc/grpc-js';
import { describe, expect, it } from 'vitest';

import { ERROR_METADATA_KEY } from '../../src/config/constants.js';
import { createEchoImplementation, echoServiceDefinition } from '../../src/example/echo-service.js';
import { toServiceError } from '../../src/grpc/status.js';
import { appErrorOf, appErrorPayloadOf, startTestGrpcServer } from '../../src/testing/index.js';
import { callByName } from './support/grpc-client.js';

function withPayload(raw: string): Error {
  const metadata = new Metadata();
  metadata.set(ERROR_METADATA_KEY, raw);
  return Object.assign(new Error('x'), { code: 13, details: 'x', metadata });
}

describe('appErrorOf / appErrorPayloadOf', () => {
  it('tam yuk: kod, mesaj, ayrinti, requestId', () => {
    const error = toServiceError(
      AppError.notFound('Urun yok', { details: { productId: 'prd_1' } }),
      { requestId: 'req_1' },
    );

    expect(appErrorPayloadOf(error)).toEqual({
      code: ERROR_CODES.NOT_FOUND,
      message: 'Urun yok',
      details: { productId: 'prd_1' },
      requestId: 'req_1',
    });
    expect(appErrorOf(error)).toEqual({
      code: ERROR_CODES.NOT_FOUND,
      details: { productId: 'prd_1' },
    });
  });

  it('ayrinti yoksa is anlami yalnizca koddur', () => {
    expect(appErrorOf(toServiceError(AppError.conflict('Cakisma')))).toEqual({
      code: ERROR_CODES.CONFLICT,
    });
  });

  it.each([
    ['gRPC hatasi degil', new Error('duz')],
    ['tanimsiz', undefined],
    ['bozuk JSON', withPayload('{bozuk')],
    ['semaya uymuyor', withPayload('{"code":42}')],
  ])('okunamayan yuk undefined: %s', (_name, error) => {
    expect(appErrorPayloadOf(error)).toBeUndefined();
    expect(appErrorOf(error)).toBeUndefined();
  });
});

describe('startTestGrpcServer', () => {
  it('bos portta acar, istemci ve tipli cagri verir; stop sunucuyu kapatir', async () => {
    const server = await startTestGrpcServer({
      serviceName: 'yardimci-test',
      services: [
        { definition: echoServiceDefinition, implementation: createEchoImplementation('t') },
      ],
    });

    const { response } = await callByName<object, { message: string }>(
      server.client,
      echoServiceDefinition,
      'Echo',
      { message: 'merhaba', repeat: 1 },
    );
    await server.stop();

    expect(server.handle.port).toBeGreaterThan(0);
    expect(response?.message).toBe('merhaba');
    expect(server.handle.health.getStatus('')).toBe('NOT_SERVING');
  });
});
