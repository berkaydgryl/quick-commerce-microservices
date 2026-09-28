/**
 * Olay zarfi (ADR-07): her olay ayni bes alanla tasinir. Zarf SABITTIR; yeni
 * bir olay yeni bir `topic` ve kendi `payload`'idir, zarfa alan eklenmez.
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
 */

import { EVENTS, ID_PREFIX, isId } from '@getir/core';
import { z } from 'zod';

export const eventEnvelopeSchema = z.object({
  eventId: z
    .string()
    .refine((value) => isId(ID_PREFIX.EVENT, value), { message: 'evt_ onekli kimlik bekleniyor' }),
  topic: z.nativeEnum(EVENTS),
  partitionKey: z.string().min(1, 'zorunlu'),
  occurredAt: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()),
});

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
