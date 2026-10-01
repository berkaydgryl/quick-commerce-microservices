/**
 * Bir gRPC cagrisinin handler'a tasidigi baglam.
 *
 * Burada IS VERISI yoktur: istegin kendisi ayri gecer. Baglam yalnizca
 * "bu cagri kim icin, hangi izle, nereye yazayim" sorularini cevaplar.
 */

import { REQUEST_ID_METADATA_KEY, resolveRequestId } from '@getir/observability';
import type { Metadata } from '@grpc/grpc-js';

import type { Logger } from '../logger.js';

export interface HandlerContext {
  /** Uctan uca korelasyon kimligi; gunlukte ve hata cevabinda ayni deger gorunur. */
  readonly requestId: string;
  /** Cagriyla gelen ham metadata (yetki basligi, idempotency anahtari...). */
  readonly metadata: Metadata;
  /** requestId ve rpc adi onceden baglanmis gunlukcu. */
  readonly logger: Logger;
}

/**
 * Metadata'daki korelasyon kimligini okur; yoksa uretir (kural
 * @getir/observability `resolveRequestId`'de). Uretmek onemli: gateway'i
 * atlayarak (grpcurl, baska bir servis, test) gelen cagrilarin da gunlukte tek
 * bir ize baglanmasi gerekir.
 */
export function requestIdFrom(metadata: Metadata): string {
  return resolveRequestId(metadata.get(REQUEST_ID_METADATA_KEY)[0]);
}
