import { AppError, ERROR_CODES, GRPC_STATUS } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine, RecordedLevel } from '@getir/core/testing';
import { metricsRegistry } from '@getir/observability';
import { histogramCount, metricSamples, metricValue } from '@getir/observability/testing';
import { Metadata } from '@grpc/grpc-js';
import type { handleUnaryCall, ServerUnaryCall, ServiceError } from '@grpc/grpc-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { REQUEST_ID_METADATA_KEY } from '../../src/config/constants.js';
import { unaryHandler } from '../../src/grpc/handler.js';
import { RPC_METRICS } from '../../src/grpc/rpc-metrics.js';
import { appErrorOf } from '../../src/testing/index.js';

const schema = z.object({
  sku: z.string().min(3),
  quantity: z.number().int().positive(),
});

interface HandlerResult<TResponse> {
  readonly error: ServiceError | undefined;
  readonly response: TResponse | undefined;
}

/** Sahte cagrinin metot yolu (span adi; D15). */
const RESERVE_PATH = '/getir.test.v1.StockService/Reserve';

/** gRPC'nin handler'a gecirdigi cagri nesnesinin testte yeten kadari. */
function fakeCall(request: unknown, metadata: Metadata): ServerUnaryCall<unknown, unknown> {
  return { request, metadata, getPath: () => RESERVE_PATH } as unknown as ServerUnaryCall<
    unknown,
    unknown
  >;
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

    const payload = appErrorOf(result.error);
    expect(payload?.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    // Hangi alanin neden gecersiz oldugu tek tek listelenir.
    expect(Object.keys(payload?.details ?? {})).toEqual(['sku', 'quantity']);
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
});

describe('unaryHandler: gunluk seviyesi kodun agirligindan (#49)', () => {
  it.each<[string, () => Error, RecordedLevel, string]>([
    [
      'beklenen is sonucu (STOCK_INSUFFICIENT)',
      () => new AppError(ERROR_CODES.STOCK_INSUFFICIENT, 'Stok yetersiz'),
      'info',
      'rpc is hatasiyla dondu',
    ],
    [
      // gRPC UNAUTHENTICATED (16) sayica INTERNAL'dan buyuk: numaradan secilseydi error olurdu.
      'oturum yok (UNAUTHORIZED)',
      () => new AppError(ERROR_CODES.UNAUTHORIZED, 'Oturum yok'),
      'info',
      'rpc is hatasiyla dondu',
    ],
    [
      'bagimli servis yok (SERVICE_UNAVAILABLE)',
      () => new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'Katalog servisine ulasilamadi'),
      'warn',
      'rpc siradisi hatayla dondu',
    ],
    [
      'AppError INTERNAL',
      () => AppError.internal('bozuk'),
      'error',
      'rpc beklenmeyen hatayla dondu',
    ],
    [
      'AppError olmayan hata',
      () => new TypeError('bozuk'),
      'error',
      'rpc beklenmeyen hatayla dondu',
    ],
  ])('%s: %s seviyesi', async (_case, makeError, level, message) => {
    const lines: LogLine[] = [];
    const handler = unaryHandler({
      name: 'Reserve',
      schema,
      logger: recordingLogger(lines),
      handle: () => {
        throw makeError();
      },
    });

    await invoke(handler, { sku: 'SUT-1L', quantity: 1 });

    expect(lines).toEqual([expect.objectContaining({ level, message })]);
    // Beklenen is sonucu ariza degildir: hata nesnesi (yigin izi) yazilmaz.
    expect('err' in (lines[0]?.fields ?? {})).toBe(level !== 'info');
  });
});

describe('unaryHandler: metrikler (T10.5)', () => {
  beforeEach(() => {
    metricsRegistry.resetMetrics();
  });

  const valid = { sku: 'SUT-1L', quantity: 1 };

  it('her cagriyi rpc ve sonuc koduyla sayar, suresini histograma yazar', async () => {
    const ok = unaryHandler({ name: 'Reserve', schema, handle: () => ({ ok: true }) });
    const noStock = unaryHandler({
      name: 'Reserve',
      schema,
      handle: () => {
        throw new AppError(ERROR_CODES.STOCK_INSUFFICIENT, 'Stok yetersiz');
      },
    });
    const crash = unaryHandler({
      name: 'Release',
      schema,
      handle: () => {
        throw new TypeError('bozuk');
      },
    });

    await invoke(ok, valid);
    await invoke(ok, valid);
    await invoke(ok, { sku: 'X', quantity: 0 });
    await invoke(noStock, valid);
    await invoke(crash, valid);

    const requests = RPC_METRICS.REQUESTS;
    expect(await metricValue(requests, { rpc: 'Reserve', code: 'OK' })).toBe(2);
    expect(await metricValue(requests, { rpc: 'Reserve', code: 'VALIDATION_FAILED' })).toBe(1);
    expect(await metricValue(requests, { rpc: 'Reserve', code: 'STOCK_INSUFFICIENT' })).toBe(1);
    // AppError olmayan hata istemciye INTERNAL gider; etiket de odur.
    expect(await metricValue(requests, { rpc: 'Release', code: 'INTERNAL' })).toBe(1);
    expect(await metricValue(requests)).toBe(5);
    expect(await histogramCount(RPC_METRICS.DURATION, { rpc: 'Reserve', code: 'OK' })).toBe(2);
    expect(await histogramCount(RPC_METRICS.DURATION)).toBe(5);
  });

  it('etiketler yalnizca rpc ve code: requestId ya da istek verisi etikete girmez', async () => {
    const handler = unaryHandler({ name: 'Reserve', schema, handle: () => ({ ok: true }) });
    const metadata = new Metadata();
    metadata.set(REQUEST_ID_METADATA_KEY, 'req_etiket_olmamali');

    await invoke(handler, valid, metadata);

    for (const name of [RPC_METRICS.REQUESTS, RPC_METRICS.DURATION]) {
      for (const sample of await metricSamples(name)) {
        // Histogram kovalari ek olarak `le` tasir (kova siniri; sabit liste).
        expect(
          Object.keys(sample.labels)
            .filter((key) => key !== 'le')
            .sort(),
        ).toEqual(['code', 'rpc']);
      }
    }
  });
});
