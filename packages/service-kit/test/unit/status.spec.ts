import { AppError, ERROR_CODES, GRPC_STATUS } from '@getir/core';
import { Metadata, status as GrpcStatus } from '@grpc/grpc-js';
import type { ServiceError } from '@grpc/grpc-js';
import { describe, expect, it } from 'vitest';

import { ERROR_METADATA_KEY, REQUEST_ID_METADATA_KEY } from '../../src/config/constants.js';
import { fromServiceError, isServiceError, toServiceError } from '../../src/grpc/status.js';
import { appErrorPayloadOf } from '../../src/testing/index.js';

const REQUEST_ID = 'req_1';

/** Metadata'daki AppError yukunu cozer (gateway'in yapacagi isin aynisi). */
const payloadOf = appErrorPayloadOf;

/** Verilen x-app-error yukunu ve durum kodunu tasiyan istemci tarafi hata. */
function serviceErrorWith(code: GrpcStatus, payload: string | undefined): ServiceError {
  const metadata = new Metadata();
  if (payload !== undefined) {
    metadata.set(ERROR_METADATA_KEY, payload);
  }
  return Object.assign(new Error('karsi taraf'), { code, details: 'karsi taraf', metadata });
}

describe('toServiceError', () => {
  it('AppError kodunu gRPC status koduna cevirir', () => {
    const error = toServiceError(
      new AppError(ERROR_CODES.STOCK_INSUFFICIENT, 'Stok yetersiz', {
        details: { sku: 'SUT-1L' },
      }),
    );

    expect(error.code).toBe(GRPC_STATUS.FAILED_PRECONDITION);
    expect(error.details).toBe('Stok yetersiz');
    expect(payloadOf(error)).toEqual({
      code: ERROR_CODES.STOCK_INSUFFICIENT,
      message: 'Stok yetersiz',
      details: { sku: 'SUT-1L' },
    });
  });

  it('bilinmeyen hatayi INTERNAL yapar ve asil mesaji sizdirmaz', () => {
    const error = toServiceError(new Error('mongo baglantisi koptu: user=admin'));

    expect(error.code).toBe(GrpcStatus.INTERNAL);
    expect(error.message).not.toContain('mongo');
    expect(JSON.stringify(payloadOf(error))).not.toContain('mongo');
  });

  it("requestId'i hem yuke hem metadata'ya yazar", () => {
    const error = toServiceError(AppError.notFound('Urun yok'), { requestId: REQUEST_ID });

    expect(error.metadata.get(REQUEST_ID_METADATA_KEY)[0]).toBe(REQUEST_ID);
    expect(payloadOf(error)?.requestId).toBe(REQUEST_ID);
  });

  it('gercek bir Error uretir; yigin izi korunur', () => {
    const error = toServiceError(AppError.forbidden('Yetki yok'));

    expect(error).toBeInstanceOf(Error);
    expect(error.stack).toBeDefined();
    expect(isServiceError(error)).toBe(true);
  });
});

describe('fromServiceError', () => {
  it("metadata varsa AppError'i oldugu gibi geri kurar", () => {
    const original = new AppError(ERROR_CODES.RESERVATION_EXPIRED, 'Rezervasyon dustu', {
      details: { reservationId: 'rsv_1' },
      requestId: REQUEST_ID,
    });

    const restored = fromServiceError(toServiceError(original));

    expect(restored.code).toBe(ERROR_CODES.RESERVATION_EXPIRED);
    expect(restored.message).toBe('Rezervasyon dustu');
    expect(restored.details).toEqual({ reservationId: 'rsv_1' });
    expect(restored.requestId).toBe(REQUEST_ID);
  });

  it('metadata yoksa status kodundan en yakin hata koduna duser', () => {
    const unavailable: ServiceError = Object.assign(new Error('no connection'), {
      code: GrpcStatus.UNAVAILABLE,
      details: 'no connection',
      metadata: new Metadata(),
    });

    expect(fromServiceError(unavailable).code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
  });

  it('bozuk metadata yukunu yok sayar', () => {
    const metadata = new Metadata();
    metadata.set(ERROR_METADATA_KEY, '{bozuk json');
    const broken: ServiceError = Object.assign(new Error('bilinmiyor'), {
      code: GrpcStatus.UNKNOWN,
      details: 'bilinmiyor',
      metadata,
    });

    expect(fromServiceError(broken).code).toBe(ERROR_CODES.INTERNAL);
  });

  it('gRPC hatasi olmayan degeri de AppError yapar', () => {
    expect(fromServiceError(new Error('duz hata')).code).toBe(ERROR_CODES.INTERNAL);
  });

  it.each([
    ['bilinmeyen kod', '{"code":"YENI_KOD","message":"x"}'],
    ['mesaj metin degil', '{"code":"NOT_FOUND","message":42}'],
    ['nesne degil', '["NOT_FOUND"]'],
  ])('semaya uymayan yuk yok sayilir, durum kodundan devam edilir (D5): %s', (_name, payload) => {
    expect(fromServiceError(serviceErrorWith(GrpcStatus.NOT_FOUND, payload)).code).toBe(
      ERROR_CODES.NOT_FOUND,
    );
  });

  it('yuksuz UNIMPLEMENTED NOT_IMPLEMENTED olur (gateway eslemesiyle ayni, D5)', () => {
    expect(fromServiceError(serviceErrorWith(GrpcStatus.UNIMPLEMENTED, undefined)).code).toBe(
      ERROR_CODES.NOT_IMPLEMENTED,
    );
  });
});
