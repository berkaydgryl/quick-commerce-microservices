/**
 * AppError <-> gRPC hatasi cevirisi. TEK YER burasidir.
 *
 * Kural (roadmap "Hata Yonetimi" tablosu): servis sinirindan disari cikan her
 * hata bir AppError'dur; gRPC katmani onu status koduna cevirir, yigin izi
 * yalnizca gunluge yazilir. Kod -> status eslemesi burada DEGIL, @getir/core
 * icindeki tek tabloda durur; bu dosya yalnizca tasima isini yapar.
 */

import type { AppErrorJson, ErrorCode } from '@getir/core';
import { AppError, ERROR_CODES, isErrorCode, toAppError } from '@getir/core';
import { Metadata, status as GrpcStatus } from '@grpc/grpc-js';
import type { ServiceError } from '@grpc/grpc-js';

import { ERROR_METADATA_KEY, REQUEST_ID_METADATA_KEY } from '../config/constants.js';

/** Hatanin uretildigi cagriya ait baglam. */
export interface ErrorContext {
  readonly requestId?: string;
}

/**
 * Herhangi bir hatayi gRPC'nin bekledigi ServiceError bicimine cevirir.
 *
 * Tasinan bilgi iki kanaldan gider:
 *  - `code` + `details`: her gRPC istemcisinin (Go dahil) okudugu standart alanlar.
 *  - `x-app-error` metadata: makine tarafindan okunacak tam AppError JSON'u
 *    (code, message, details, requestId). Gateway REST zarfini bundan kurar.
 */
export function toServiceError(error: unknown, context: ErrorContext = {}): ServiceError {
  const appError = toAppError(
    error,
    context.requestId === undefined ? {} : { requestId: context.requestId },
  );

  const payload: AppErrorJson = appError.toJSON();
  if (payload.requestId === undefined && context.requestId !== undefined) {
    payload.requestId = context.requestId;
  }

  const metadata = new Metadata();
  metadata.set(ERROR_METADATA_KEY, JSON.stringify(payload));
  if (payload.requestId !== undefined) {
    metadata.set(REQUEST_ID_METADATA_KEY, payload.requestId);
  }

  // ServiceError, Error'un uzerine gRPC alanlarini ekleyen bir ARAYUZDUR
  // (sinif degil); bu yuzden gercek bir Error uretip alanlari uzerine yaziyoruz.
  // Boylece yigin izi korunur ve `instanceof Error` dogru kalir.
  const serviceError = new Error(appError.message) as ServiceError;
  serviceError.name = 'ServiceError';
  serviceError.code = appError.grpcStatus;
  serviceError.details = appError.message;
  serviceError.metadata = metadata;
  return serviceError;
}

/**
 * Bir gRPC hatasini AppError'a geri cevirir; servisler birbirini cagirirken
 * kullanilir. Karsi taraf metadata koymadiysa (bizim olmayan bir sunucu, ag
 * hatasi, deadline) status kodundan en yakin hata kodu turetilir.
 */
export function fromServiceError(error: unknown): AppError {
  if (!isServiceError(error)) {
    return toAppError(error);
  }

  const parsed = parseErrorMetadata(error.metadata);
  if (parsed !== undefined) {
    return new AppError(parsed.code, parsed.message, {
      ...(parsed.details === undefined ? {} : { details: parsed.details }),
      ...(parsed.requestId === undefined ? {} : { requestId: parsed.requestId }),
      cause: error,
    });
  }

  return new AppError(errorCodeForStatus(error.code), error.details || error.message, {
    cause: error,
  });
}

/** Deger, gRPC istemcisinden gelen bir ServiceError mi? */
export function isServiceError(value: unknown): value is ServiceError {
  return value instanceof Error && typeof (value as Partial<ServiceError>).code === 'number';
}

/** Metadata icindeki `x-app-error` yukunu cozer; yoksa veya bozuksa undefined. */
function parseErrorMetadata(metadata: Metadata | undefined): AppErrorJson | undefined {
  const raw = metadata?.get(ERROR_METADATA_KEY)[0];
  if (typeof raw !== 'string') {
    return undefined;
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    // Bozuk yuk, hatanin kendisini gizlemeye degmez: status kodundan devam edilir.
    return undefined;
  }

  if (typeof decoded !== 'object' || decoded === null) {
    return undefined;
  }
  const candidate = decoded as Record<string, unknown>;
  if (!isErrorCode(candidate.code) || typeof candidate.message !== 'string') {
    return undefined;
  }

  const json: AppErrorJson = { code: candidate.code, message: candidate.message };
  if (candidate.details !== undefined) {
    json.details = candidate.details;
  }
  if (typeof candidate.requestId === 'string') {
    json.requestId = candidate.requestId;
  }
  return json;
}

/**
 * gRPC status -> hata kodu (ters yon, yalnizca metadata yokken).
 * Eslemeyen her status INTERNAL'a duser: bilmedigimiz bir hatayi is hatasi
 * gibi gostermek, cagiran tarafta yanlis kullanici mesajina yol acar.
 */
function errorCodeForStatus(code: GrpcStatus): ErrorCode {
  switch (code) {
    case GrpcStatus.INVALID_ARGUMENT:
    case GrpcStatus.OUT_OF_RANGE:
      return ERROR_CODES.VALIDATION_FAILED;
    case GrpcStatus.UNAUTHENTICATED:
      return ERROR_CODES.UNAUTHORIZED;
    case GrpcStatus.PERMISSION_DENIED:
      return ERROR_CODES.FORBIDDEN;
    case GrpcStatus.NOT_FOUND:
      return ERROR_CODES.NOT_FOUND;
    case GrpcStatus.ALREADY_EXISTS:
    case GrpcStatus.ABORTED:
      return ERROR_CODES.CONFLICT;
    case GrpcStatus.RESOURCE_EXHAUSTED:
      return ERROR_CODES.RATE_LIMITED;
    // Bagimli servis kapali, deadline doldu veya cagri iptal edildi: uclu de
    // "su an cevap alamadik" demektir ve yeniden denenebilir.
    case GrpcStatus.UNAVAILABLE:
    case GrpcStatus.DEADLINE_EXCEEDED:
    case GrpcStatus.CANCELLED:
      return ERROR_CODES.SERVICE_UNAVAILABLE;
    default:
      return ERROR_CODES.INTERNAL;
  }
}
