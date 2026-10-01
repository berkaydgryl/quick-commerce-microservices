/**
 * Olay zarfi (ADR-07): her olay ayni bes alanla tasinir. Yeni bir olay yeni bir
 * `topic` ve kendi `payload`'idir; zarf YALNIZCA istege bagli korelasyon
 * alanlariyla genisler (D16, ADR-07 eki): eski kayitlar gecerli kalir.
 *
 *   eventId      evt_<32 hex>. Teslimat en az bir kezdir (ADR-04): tuketici
 *                olayi bununla tekillestirir.
 *   topic        @getir/core EVENTS sozlugunden ("order.status_changed").
 *   partitionKey Siralamanin gecerli oldugu anahtar (siparis olaylarinda
 *                orderId). Kafka'ya geciste bolum anahtari olur.
 *   occurredAt   Olayin oldugu an, ISO 8601 UTC (JSON'da Date yok).
 *   payload      Olaya ozel govde. Dinlenen olaylarin govde semasi
 *                @getir/contracts events.ts'tedir: ureten tipten kurar, tuketen
 *                semadan gecirir (T7.4). Zarf govdeyi yalnizca nesne olarak bilir.
 *
 * Korelasyon (istege bagli; D16):
 *   requestId    Olayi doguran istegin kimligi (req_<32 hex>): tuketicinin
 *                gunlugu ayni kimligi yazar.
 *   traceparent  Olayi yayinlayan span'in W3C iz baglami: tuketicinin span'i
 *                ayni izde, onun cocugu olur (ADR-20).
 */

import { EVENTS, ID_PREFIX, isId } from '@getir/core';
import { z } from 'zod';

/** W3C trace context, surum 00: 00-<32 hex iz>-<16 hex span>-<2 hex bayrak>. */
const TRACEPARENT_PATTERN = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;

const requestIdSchema = z
  .string()
  .refine((value) => isId(ID_PREFIX.REQUEST, value), { message: 'req_ onekli kimlik bekleniyor' });
const traceparentSchema = z.string().regex(TRACEPARENT_PATTERN, 'W3C traceparent bekleniyor');

export const eventEnvelopeSchema = z.object({
  eventId: z
    .string()
    .refine((value) => isId(ID_PREFIX.EVENT, value), { message: 'evt_ onekli kimlik bekleniyor' }),
  topic: z.nativeEnum(EVENTS),
  partitionKey: z.string().min(1, 'zorunlu'),
  occurredAt: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()),
  requestId: requestIdSchema.optional(),
  traceparent: traceparentSchema.optional(),
});

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

/** Zarfin korelasyon alanlari (D16): outbox ve yayinci yalnizca bunlari tasir. */
export type EnvelopeCorrelation = Pick<EventEnvelope, 'requestId' | 'traceparent'>;

/**
 * Gecerli korelasyon alanlari; bicimsiz olan atilir. Bozuk zarf hatta giremez ve
 * outbox yayinini durdurur (ADR-04): korelasyon yuzunden olay takilmasin.
 */
export function validCorrelation(candidate: {
  readonly requestId?: string | undefined;
  readonly traceparent?: string | undefined;
}): EnvelopeCorrelation {
  const requestId = requestIdSchema.safeParse(candidate.requestId);
  const traceparent = traceparentSchema.safeParse(candidate.traceparent);
  return {
    ...(requestId.success ? { requestId: requestId.data } : {}),
    ...(traceparent.success ? { traceparent: traceparent.data } : {}),
  };
}
