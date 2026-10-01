/**
 * Olay hattinda korelasyon (D16, ADR-07 eki): bir istegin requestId'si ve iz
 * baglami, istegin AKTIF BAGLAMINDAN okunur ve olay zarfiyla tasinir.
 *
 * requestId baglama iki yerde konur: gRPC handler'i (service-kit unaryHandler)
 * ve olay isleyicisi (event-bus). Boylece outbox yazicisi gibi altyapi kodu
 * use-case'e parametre eklemeden okur. traceparent aktif span'den W3C bicimiyle
 * yazilir; saglayici kurulmamissa ya da span gecersizse yoktur.
 *
 * Yalnizca GECERLI degerler doner: zarf semasi bu alanlari dogrular ve bozuk zarf
 * outbox yayinini durdurur (ADR-04), bu yuzden bicimsiz requestId (grpcurl gibi
 * gateway disi bir cagridan) tasinmaz.
 */

import { ID_PREFIX, isId } from '@getir/core';
import { context, createContextKey, propagation, ROOT_CONTEXT } from '@opentelemetry/api';
import type { Context } from '@opentelemetry/api';

/** W3C iz basliginin adi: gRPC metadata'sinda ve olay zarfinda ayni ad. */
export const TRACEPARENT_KEY = 'traceparent';

const REQUEST_ID_CONTEXT_KEY = createContextKey('getir.request_id');

/** Olayi doguran istegin izleri; ikisi de istege baglidir. */
export interface Correlation {
  readonly requestId?: string;
  readonly traceparent?: string;
}

/** Baglama requestId koyar (handler ve olay isleyicisi icin). */
export function withRequestId(ctx: Context, requestId: string): Context {
  return ctx.setValue(REQUEST_ID_CONTEXT_KEY, requestId);
}

/** Baglamdaki requestId; konmamissa undefined. */
export function activeRequestId(ctx: Context = context.active()): string | undefined {
  const value = ctx.getValue(REQUEST_ID_CONTEXT_KEY);
  return typeof value === 'string' ? value : undefined;
}

/** Baglamin korelasyonu: outbox satirina ve olay zarfina yazilacak alanlar. */
export function currentCorrelation(ctx: Context = context.active()): Correlation {
  const carrier: Record<string, string> = {};
  propagation.inject(ctx, carrier);
  const requestId = activeRequestId(ctx);
  const traceparent = carrier[TRACEPARENT_KEY];
  return {
    ...(isId(ID_PREFIX.REQUEST, requestId) ? { requestId } : {}),
    ...(traceparent === undefined ? {} : { traceparent }),
  };
}

/** traceparent'in tasidigi ust baglam; deger yoksa ya da gecersizse kok baglam. */
export function contextFromTraceparent(traceparent: string | undefined): Context {
  return traceparent === undefined
    ? ROOT_CONTEXT
    : propagation.extract(ROOT_CONTEXT, { [TRACEPARENT_KEY]: traceparent });
}
