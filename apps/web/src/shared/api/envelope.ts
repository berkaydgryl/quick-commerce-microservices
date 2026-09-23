/**
 * Cevap zarfini acar: { success: true, data } -> data,
 * { success: false, error } -> AppError firlatir.
 *
 * Her uc ayri kontrol yazmaz; zarfin sekli ve hata cevirisi yalnizca buradadir.
 * Cevap semaya uymuyorsa sozlesme kirilmistir: tipsiz veri uygulamaya girmez.
 */

import { apiErrorResponseSchema, apiSuccessResponseSchema, errorMessage } from '@getir/contracts';
import { AppError, ERROR_CODES } from '@getir/core';
import { z } from 'zod';

/** Basari zarfinin kabugu; `data` ayrica cagiranin semasiyla dogrulanir. */
const successEnvelopeSchema = apiSuccessResponseSchema(z.unknown());

export function unwrapEnvelope<T>(dataSchema: z.ZodType<T>, payload: unknown): T {
  // Hata kolu once denenir: hata cevabi `data` tasimaz ve veri semasina bakilmaz.
  const failure = apiErrorResponseSchema.safeParse(payload);
  if (failure.success) {
    const { code, message, details, requestId } = failure.data.error;
    throw new AppError(code, message, { details, requestId });
  }

  // Zarf ve veri AYRI dogrulanir: jenerik sema zarfin icine gomulunce z.infer
  // T'yi koruyamiyor; veriyi dogrudan kendi semasindan gecirmek T'yi korur.
  const envelope = successEnvelopeSchema.safeParse(payload);
  const data = envelope.success ? dataSchema.safeParse(envelope.data.data) : envelope;
  if (!data.success) {
    throw new AppError(ERROR_CODES.INTERNAL, errorMessage(ERROR_CODES.INTERNAL), {
      cause: data.error,
    });
  }
  return data.data;
}
