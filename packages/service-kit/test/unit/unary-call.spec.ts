import { AppError, ERROR_CODES, isAppError } from '@getir/core';
import { Metadata, status as GrpcStatus } from '@grpc/grpc-js';
import type { CallOptions, ClientUnaryCall, ServiceError } from '@grpc/grpc-js';
import { describe, expect, it } from 'vitest';

import { REQUEST_ID_METADATA_KEY } from '../../src/config/constants.js';
import { toServiceError } from '../../src/grpc/status.js';
import type { UnaryInvoker } from '../../src/grpc/unary-call.js';
import { callUnary } from '../../src/grpc/unary-call.js';

interface Captured {
  metadata?: Metadata;
  options?: Partial<CallOptions>;
}

/** Ag yok: uretilen istemcinin metodu yerine gecer, gelenleri kaydeder ve verileni doner. */
function fakeInvoker(
  outcome: { readonly error: ServiceError } | { readonly response: string },
  captured: Captured,
): UnaryInvoker<string, string> {
  return (_request, metadata, options, callback) => {
    captured.metadata = metadata;
    captured.options = options;
    if ('error' in outcome) callback(outcome.error, '');
    else callback(null, outcome.response);
    return {} as ClientUnaryCall;
  };
}

function statusOnlyError(code: GrpcStatus): ServiceError {
  return Object.assign(new Error('ag hatasi'), {
    code,
    details: 'ag hatasi',
    metadata: new Metadata(),
  });
}

describe('callUnary', () => {
  it('x-request-id AYNEN gider ve cagrinin sure siniri konur', async () => {
    const captured: Captured = {};
    const before = Date.now();

    await expect(
      callUnary(fakeInvoker({ response: 'tamam' }, captured), 'istek', {
        requestId: 'req_iz_1',
        timeoutMs: 2_000,
      }),
    ).resolves.toBe('tamam');

    expect(captured.metadata?.get(REQUEST_ID_METADATA_KEY)).toEqual(['req_iz_1']);
    const deadline = captured.options?.deadline;
    expect(typeof deadline).toBe('number');
    expect(deadline).toBeGreaterThanOrEqual(before + 2_000);
  });

  it('karsi tarafin is hatasi (x-app-error) kodu ve ayrintisiyla korunur', async () => {
    const remote = toServiceError(
      AppError.notFound('Market bulunamadi', { details: { marketId: 'mkt_x' } }),
    );

    const error: unknown = await callUnary(fakeInvoker({ error: remote }, {}), 'istek', {
      requestId: 'req_iz_2',
      timeoutMs: 100,
    }).catch((reason: unknown) => reason);

    expect(isAppError(error)).toBe(true);
    expect(error).toMatchObject({ code: ERROR_CODES.NOT_FOUND, details: { marketId: 'mkt_x' } });
  });

  it.each([GrpcStatus.UNAVAILABLE, GrpcStatus.DEADLINE_EXCEEDED])(
    'metadata yoksa status %s -> SERVICE_UNAVAILABLE',
    async (code) => {
      const error: unknown = await callUnary(
        fakeInvoker({ error: statusOnlyError(code) }, {}),
        'istek',
        { requestId: 'req_iz_3', timeoutMs: 100 },
      ).catch((reason: unknown) => reason);

      expect(error).toMatchObject({ code: ERROR_CODES.SERVICE_UNAVAILABLE });
    },
  );
});
