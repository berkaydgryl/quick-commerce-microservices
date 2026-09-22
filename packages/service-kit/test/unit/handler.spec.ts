import { AppError, ERROR_CODES, GRPC_STATUS } from '@getir/core';
import { Metadata } from '@grpc/grpc-js';
import type { handleUnaryCall, ServerUnaryCall, ServiceError } from '@grpc/grpc-js';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ERROR_METADATA_KEY, REQUEST_ID_METADATA_KEY } from '../../src/config/constants.js';
import { unaryHandler } from '../../src/grpc/handler.js';
import type { Logger } from '../../src/logger.js';

const schema = z.object({
  sku: z.string().min(3),
  quantity: z.number().int().positive(),
});

interface HandlerResult<TResponse> {
  readonly error: ServiceError | undefined;
  readonly response: TResponse | undefined;
}

/** gRPC'nin handler'a gecirdigi cagri nesnesinin testte yeten kadari. */
function fakeCall(request: unknown, metadata: Metadata): ServerUnaryCall<unknown, unknown> {
  return { request, metadata } as unknown as ServerUnaryCall<unknown, unknown>;
}

function invoke<TResponse>(
  handler: handleUnaryCall<unknown, TResponse>,
  request: unknown,
  metadata: Metadata = new Metadata(),
): Promise<HandlerResult<TResponse>> {
  return new Promise((resolve) => {
    handler(fakeCall(request, metadata), (error, value) => {
      resolve({
        error: (error ?? undefined) as ServiceError | undefined,
        response: value ?? undefined,
      });
    });
  });
}

/** Cagrilari sayan sahte gunlukcu. */
function spyLogger(): Logger & { calls: { level: string; fields: Record<string, unknown> }[] } {
  const calls: { level: string; fields: Record<string, unknown> }[] = [];
  const record =
    (level: string) =>
    (fields: Record<string, unknown>): void => {
      calls.push({ level, fields });
    };
  const logger: Logger & { calls: typeof calls } = {
    calls,
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    fatal: record('fatal'),
    child: () => logger,
  };
  return logger;
}

describe('unaryHandler', () => {
  it("dogrulanmis girdiyi handler'a tipli olarak gecirir", async () => {
    const handle = vi.fn((_input: z.infer<typeof schema>) => ({ ok: true }));
    const handler = unaryHandler({ name: 'Reserve', schema, handle });

    const result = await invoke(handler, { sku: 'SUT-1L', quantity: 2 });

    expect(result.error).toBeUndefined();
    expect(result.response).toEqual({ ok: true });
    expect(handle).toHaveBeenCalledOnce();
    expect(handle.mock.calls[0]?.[0]).toEqual({ sku: 'SUT-1L', quantity: 2 });
  });

  it('gecersiz istegi INVALID_ARGUMENT ile reddeder ve handler cagrilmaz', async () => {
    const handle = vi.fn(() => ({ ok: true }));
    const handler = unaryHandler({ name: 'Reserve', schema, handle });

    const result = await invoke(handler, { sku: 'X', quantity: 0 });

    expect(handle).not.toHaveBeenCalled();
    expect(result.error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);

    const payload = JSON.parse(String(result.error?.metadata.get(ERROR_METADATA_KEY)[0])) as {
      code: string;
      details: Record<string, string>;
    };
    expect(payload.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    // Hangi alanin neden gecersiz oldugu tek tek listelenir.
    expect(Object.keys(payload.details)).toEqual(['sku', 'quantity']);
  });

  it('AppError kodunu koruyarak dondurur', async () => {
    const handler = unaryHandler({
      name: 'Reserve',
      schema,
      handle: () => {
        throw new AppError(ERROR_CODES.STOCK_INSUFFICIENT, 'Stok yetersiz');
      },
    });

    const result = await invoke(handler, { sku: 'SUT-1L', quantity: 2 });

    expect(result.error?.code).toBe(GRPC_STATUS.FAILED_PRECONDITION);
  });

  it('beklenmeyen hatayi INTERNAL yapar ve ic mesaji sizdirmaz', async () => {
    const handler = unaryHandler({
      name: 'Reserve',
      schema,
      handle: () => {
        throw new Error('mongo: auth failed for user admin');
      },
    });

    const result = await invoke(handler, { sku: 'SUT-1L', quantity: 2 });

    expect(result.error?.code).toBe(GRPC_STATUS.INTERNAL);
    expect(result.error?.message).not.toContain('admin');
  });

  it("metadata'daki requestId'i kullanir, yoksa uretir", async () => {
    const handler = unaryHandler({
      name: 'Reserve',
      schema,
      handle: (_input, context) => ({ requestId: context.requestId }),
    });

    const metadata = new Metadata();
    metadata.set(REQUEST_ID_METADATA_KEY, 'req_gateway');
    const withId = await invoke<{ requestId: string }>(
      handler,
      { sku: 'SUT-1L', quantity: 1 },
      metadata,
    );
    const withoutId = await invoke<{ requestId: string }>(handler, { sku: 'SUT-1L', quantity: 1 });

    expect(withId.response?.requestId).toBe('req_gateway');
    expect(withoutId.response?.requestId).toMatch(/^req_[0-9a-f]{32}$/);
  });

  it('is hatasini warn, beklenmeyen hatayi error seviyesinde gunluge yazar', async () => {
    const logger = spyLogger();
    const business = unaryHandler({
      name: 'Reserve',
      schema,
      logger,
      handle: () => {
        throw AppError.conflict('Cakisma');
      },
    });
    const unexpected = unaryHandler({
      name: 'Reserve',
      schema,
      logger,
      handle: () => {
        throw new TypeError('bozuk');
      },
    });

    await invoke(business, { sku: 'SUT-1L', quantity: 1 });
    await invoke(unexpected, { sku: 'SUT-1L', quantity: 1 });

    expect(logger.calls.map((call) => call.level)).toEqual(['warn', 'error']);
  });
});
