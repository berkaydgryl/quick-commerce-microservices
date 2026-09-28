/**
 * Health Watch isteginin dogrulanmasi (D5): istek dis veridir, Check ile ayni
 * semadan gecer. Gecersiz istek akisi INVALID_ARGUMENT ile kapatir ve abonelik
 * hic acilmaz.
 *
 * Gecersiz mesaj ag uzerinden uretilemez (istemci proto'ya gore kodlar); bu
 * yuzden akisin sunucu tarafi sahte bir nesneyle taklit edilir.
 */

import { EventEmitter } from 'node:events';

import { ERROR_CODES, GRPC_STATUS } from '@getir/core';
import { Metadata } from '@grpc/grpc-js';
import type { ServerWritableStream, ServiceError } from '@grpc/grpc-js';
import { describe, expect, it, vi } from 'vitest';

import { REQUEST_ID_METADATA_KEY, SERVING_STATUS } from '../../src/config/constants.js';
import { HealthGrpcService } from '../../src/grpc/health.js';
import { HealthRegistry } from '../../src/health/registry.js';
import { appErrorPayloadOf } from '../../src/testing/index.js';

/** Watch'in sunucu akisinin testte yeten kadari. */
class FakeWatchStream extends EventEmitter {
  readonly written: unknown[] = [];
  readonly errors: ServiceError[] = [];
  readonly metadata = new Metadata();

  constructor(readonly request: unknown) {
    super();
    this.on('error', (error: ServiceError) => {
      this.errors.push(error);
    });
  }

  write(message: unknown): boolean {
    this.written.push(message);
    return true;
  }

  end(): void {
    this.emit('finish');
  }
}

function watch(service: HealthGrpcService, stream: FakeWatchStream): void {
  const handler = service.implementation['Watch'] as (
    call: ServerWritableStream<unknown, unknown>,
  ) => void;
  handler(stream as unknown as ServerWritableStream<unknown, unknown>);
}

describe('Health Watch istegi', () => {
  it('gecerli istek: mevcut durum yazilir ve abonelik acilir', () => {
    const registry = new HealthRegistry();
    registry.setStatus('', SERVING_STATUS.SERVING);
    const subscribe = vi.spyOn(registry, 'subscribe');
    const stream = new FakeWatchStream({ service: '' });

    watch(new HealthGrpcService(registry), stream);

    expect(stream.written).toEqual([{ status: SERVING_STATUS.SERVING }]);
    expect(subscribe).toHaveBeenCalledOnce();
  });

  it('gecersiz istek INVALID_ARGUMENT ile kapanir; hata yuku ve requestId tasir, abonelik acilmaz', () => {
    const registry = new HealthRegistry();
    const subscribe = vi.spyOn(registry, 'subscribe');
    const stream = new FakeWatchStream({ service: 42 });
    stream.metadata.set(REQUEST_ID_METADATA_KEY, 'req_watch');

    watch(new HealthGrpcService(registry), stream);

    expect(stream.errors).toHaveLength(1);
    expect(stream.errors[0]?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(appErrorPayloadOf(stream.errors[0])).toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
      requestId: 'req_watch',
      details: { service: expect.any(String) as unknown },
    });
    expect(stream.written).toEqual([]);
    expect(subscribe).not.toHaveBeenCalled();
  });
});
