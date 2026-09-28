/**
 * Gelen gRPC mesajinin dogrulanmasi (ADR-10): unary handler'lar ve Health
 * Watch akisi AYNI kapidan gecer. Gecersiz istek alan listesiyle birlikte
 * VALIDATION_FAILED (gRPC INVALID_ARGUMENT) olur.
 */

import { AppError } from '@getir/core';
import type { z } from 'zod';

/** Ham gRPC mesajini alip tipli girdi ureten sema. */
export type RequestSchema<TInput> = z.ZodType<TInput, z.ZodTypeDef, unknown>;

/** Semayi uygular; basarisizsa alan listesini tasiyan bir AppError firlatir. */
export function parseRequest<TInput>(
  schema: RequestSchema<TInput>,
  request: unknown,
  requestId: string,
): TInput {
  const result = schema.safeParse(request);
  if (result.success) {
    return result.data;
  }

  // Ayrintiyi string->string tutuyoruz: getir.common.v1.ErrorDetail.metadata
  // ayni bicimde ve gateway bunu REST zarfindaki `error.details` alanina
  // oldugu gibi gecirebiliyor.
  const details: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const field = issue.path.length > 0 ? issue.path.join('.') : '(kok)';
    details[field] = issue.message;
  }

  throw AppError.validation('Gecersiz istek', { details, requestId });
}
