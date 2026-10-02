import { AppError, ERROR_CODES, isAppError } from '@getir/core';
import { Metadata, status as GrpcStatus } from '@grpc/grpc-js';
import type { CallOptions, ClientUnaryCall, ServiceError } from '@grpc/grpc-js';
import { metricsRegistry } from '@getir/observability';
import { metricValue } from '@getir/observability/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { REQUEST_ID_METADATA_KEY } from '../../src/config/constants.js';
import { toServiceError } from '../../src/grpc/status.js';
import { BREAKER_STATE, CircuitBreaker } from '../../src/grpc/circuit-breaker.js';
import { CLIENT_METRICS } from '../../src/grpc/client-metrics.js';
import type { RetryPolicy, UnaryInvoker } from '../../src/grpc/unary-call.js';
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

/** Siradaki cevaplari sirayla veren sahte cagri; her denemeyi ve deadline'ini kaydeder. */
function scriptedInvoker(
  outcomes: readonly ({ readonly error: ServiceError } | { readonly response: string })[],
  deadlines: (number | undefined)[] = [],
): UnaryInvoker<string, string> {
  let index = 0;
  return (_request, _metadata, options, callback) => {
    deadlines.push(typeof options.deadline === 'number' ? options.deadline : undefined);
    const outcome = outcomes[Math.min(index, outcomes.length - 1)];
    index += 1;
    if (outcome !== undefined && 'error' in outcome) callback(outcome.error, '');
    else callback(null, outcome?.response ?? '');
    return {} as ClientUnaryCall;
  };
}

const unavailable = { error: statusOnlyError(GrpcStatus.UNAVAILABLE) } as const;
const declined = {
  error: toServiceError(new AppError(ERROR_CODES.PAYMENT_DECLINED, 'kart reddi')),
} as const;
const RETRY: RetryPolicy = { maxRetries: 2, baseDelayMs: 1, target: 'inventory' };

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
}

describe('callUnary - yeniden deneme (D17)', () => {
  beforeEach(() => {
    metricsRegistry.resetMetrics();
  });

  it('ulasilamaz hatada denenir; ikinci deneme cevap alirsa sonuc doner, deneme sayilir', async () => {
    const deadlines: (number | undefined)[] = [];

    await expect(
      callUnary(scriptedInvoker([unavailable, { response: 'tamam' }], deadlines), 'istek', {
        requestId: 'req_tekrar_1',
        timeoutMs: 1_000,
        retry: RETRY,
      }),
    ).resolves.toBe('tamam');

    expect(deadlines).toHaveLength(2);
    // Denemeler TEK sure sinirini paylasir: toplam sure uzamaz.
    expect(deadlines[1]).toBe(deadlines[0]);
    expect(await metricValue(CLIENT_METRICS.RETRIES, { target: 'inventory' })).toBe(1);
  });

  it('en fazla maxRetries kadar denenir; son hata aynen doner', async () => {
    const deadlines: (number | undefined)[] = [];

    const error = await failureOf(
      callUnary(scriptedInvoker([unavailable], deadlines), 'istek', {
        requestId: 'req_tekrar_2',
        timeoutMs: 1_000,
        retry: RETRY,
      }),
    );

    expect(error).toMatchObject({ code: ERROR_CODES.SERVICE_UNAVAILABLE });
    expect(deadlines).toHaveLength(3);
  });

  it('is hatasi DENENMEZ (kart reddi tekrar edilirse sonucu degismez)', async () => {
    const deadlines: (number | undefined)[] = [];

    const error = await failureOf(
      callUnary(scriptedInvoker([declined], deadlines), 'istek', {
        requestId: 'req_tekrar_3',
        timeoutMs: 1_000,
        retry: RETRY,
      }),
    );

    expect(error).toMatchObject({ code: ERROR_CODES.PAYMENT_DECLINED });
    expect(deadlines).toHaveLength(1);
  });

  it('retry verilmeyen (idempotent olmayan) cagri DENENMEZ', async () => {
    const deadlines: (number | undefined)[] = [];

    await failureOf(
      callUnary(scriptedInvoker([unavailable, { response: 'tamam' }], deadlines), 'istek', {
        requestId: 'req_tekrar_4',
        timeoutMs: 1_000,
      }),
    );

    expect(deadlines).toHaveLength(1);
  });

  it('kalan sure yetmiyorsa denenmez (cagiranin zaman butcesi bozulmaz)', async () => {
    const deadlines: (number | undefined)[] = [];

    await failureOf(
      callUnary(scriptedInvoker([unavailable, { response: 'tamam' }], deadlines), 'istek', {
        requestId: 'req_tekrar_5',
        timeoutMs: 30,
        retry: RETRY,
      }),
    );

    expect(deadlines).toHaveLength(1);
  });
});

describe('callUnary - devre kesici (D17)', () => {
  const breakerOf = (threshold: number) =>
    new CircuitBreaker({ target: 'payment', failureThreshold: threshold, openMs: 60_000 });

  beforeEach(() => {
    metricsRegistry.resetMetrics();
  });

  it('ulasilamaz hatalar devreyi acar; acik devrede cagri ag a GITMEZ, SERVICE_UNAVAILABLE', async () => {
    const breaker = breakerOf(2);
    const deadlines: (number | undefined)[] = [];
    const invoke = scriptedInvoker([unavailable], deadlines);
    const options = { requestId: 'req_devre_1', timeoutMs: 1_000, breaker };

    await failureOf(callUnary(invoke, 'istek', options));
    await failureOf(callUnary(invoke, 'istek', options));
    const rejected = await failureOf(callUnary(invoke, 'istek', options));

    expect(breaker.currentState).toBe(BREAKER_STATE.OPEN);
    expect(deadlines).toHaveLength(2);
    expect(rejected).toMatchObject({ code: ERROR_CODES.SERVICE_UNAVAILABLE });
    expect(await metricValue(CLIENT_METRICS.BREAKER_REJECTED, { target: 'payment' })).toBe(1);
  });

  it('is hatalari devreyi ACMAZ: servis cevap veriyor', async () => {
    const breaker = breakerOf(2);
    const invoke = scriptedInvoker([declined]);
    const options = { requestId: 'req_devre_2', timeoutMs: 1_000, breaker };

    for (let i = 0; i < 5; i += 1) {
      await failureOf(callUnary(invoke, 'istek', options));
    }

    expect(breaker.currentState).toBe(BREAKER_STATE.CLOSED);
  });

  it('yeniden denemeler de devreye sayilir; devre acilinca kalan denemeler yapilmaz', async () => {
    const breaker = breakerOf(2);
    const deadlines: (number | undefined)[] = [];

    await failureOf(
      callUnary(scriptedInvoker([unavailable], deadlines), 'istek', {
        requestId: 'req_devre_3',
        timeoutMs: 1_000,
        breaker,
        retry: RETRY,
      }),
    );

    expect(deadlines).toHaveLength(2);
    expect(breaker.currentState).toBe(BREAKER_STATE.OPEN);
  });
});
