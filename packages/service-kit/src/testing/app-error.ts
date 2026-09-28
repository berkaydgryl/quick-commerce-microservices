/**
 * Test tarafinda `x-app-error` okuyucusu (D5). Once dort kopyasi vardi
 * (catalog, order, payment, risk) ve service-kit'in kendi testleri yuku
 * `JSON.parse(...) as` ile zorluyordu.
 *
 * BAGIMSIZ OKUYUCU: uretim kodunun cozucusunu (status.ts) KULLANMAZ; testin
 * dogrulamasi, test edilen kodla ayni hatayi paylasmasin. Metadata dis veridir:
 * semadan gecer (ADR-10).
 */

import { Metadata } from '@grpc/grpc-js';
import { z } from 'zod';

import { ERROR_METADATA_KEY } from '../config/constants.js';

const appErrorPayloadSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  details: z.unknown().optional(),
  requestId: z.string().optional(),
});

/** `x-app-error`'in tam yuku: kod, mesaj, ayrinti ve requestId. */
export type AppErrorPayload = z.infer<typeof appErrorPayloadSchema>;

/** Hatanin IS anlami: kod ve (varsa) ayrinti. */
export interface AppErrorMeaning {
  readonly code: string;
  readonly details?: unknown;
}

/**
 * Hatanin tam yukunu okur; ServiceError degilse ya da yuk yok/bozuksa undefined.
 * `instanceof Metadata` depoda grpc-js'in TEK kopyasi olmasina dayanir (bugun
 * 1.14.5); ikinci kopya gelirse okuyucu undefined doner ve kodu karsilastiran
 * testler kirilir - sessiz gecmez.
 */
export function appErrorPayloadOf(error: unknown): AppErrorPayload | undefined {
  if (
    !(error instanceof Error) ||
    !('metadata' in error) ||
    !(error.metadata instanceof Metadata)
  ) {
    return undefined;
  }
  const raw = error.metadata.get(ERROR_METADATA_KEY)[0];
  if (typeof raw !== 'string') {
    return undefined;
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const parsed = appErrorPayloadSchema.safeParse(decoded);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Testlerin cogunun karsilastirdigi kisim: kod ve ayrinti. Mesaj ve requestId
 * bilerek disarida: `toEqual({ code, details })` onlara bagli kalmasin.
 */
export function appErrorOf(error: unknown): AppErrorMeaning | undefined {
  const payload = appErrorPayloadOf(error);
  if (payload === undefined) {
    return undefined;
  }
  return payload.details === undefined
    ? { code: payload.code }
    : { code: payload.code, details: payload.details };
}
