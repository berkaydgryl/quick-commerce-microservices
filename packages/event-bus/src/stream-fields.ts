/**
 * Zarf <-> Redis Streams alanlari. Stream kaydi duz alan/deger ciftleridir;
 * payload JSON metni olarak tasinir. Ceviri tek yerde: yayinci yazar, tuketici
 * (T7.4) ayni fonksiyonla okur. Korelasyon alanlari (D16) yalnizca varsa yazilir:
 * eski kayitlarda yoktur, okuma onlarsiz da gecerlidir.
 */

import { AppError } from '@getir/core';

import { eventEnvelopeSchema, validCorrelation } from './envelope.js';
import type { EventEnvelope } from './envelope.js';

const FIELD = {
  EVENT_ID: 'eventId',
  TOPIC: 'topic',
  PARTITION_KEY: 'partitionKey',
  OCCURRED_AT: 'occurredAt',
  PAYLOAD: 'payload',
  REQUEST_ID: 'requestId',
  TRACEPARENT: 'traceparent',
} as const;

/** XADD icin duz alan listesi: [ad, deger, ad, deger, ...]. */
export function toStreamFields(envelope: EventEnvelope): string[] {
  return [
    FIELD.EVENT_ID,
    envelope.eventId,
    FIELD.TOPIC,
    envelope.topic,
    FIELD.PARTITION_KEY,
    envelope.partitionKey,
    FIELD.OCCURRED_AT,
    envelope.occurredAt,
    FIELD.PAYLOAD,
    JSON.stringify(envelope.payload),
    ...(envelope.requestId === undefined ? [] : [FIELD.REQUEST_ID, envelope.requestId]),
    ...(envelope.traceparent === undefined ? [] : [FIELD.TRACEPARENT, envelope.traceparent]),
  ];
}

/** Kaydin kimlik, konu ve istek alanlari, DOGRULAMADAN (yonlendirme ve gunluk icin). */
export interface EnvelopePeek {
  readonly eventId: string | undefined;
  readonly topic: string | undefined;
  readonly requestId: string | undefined;
}

/**
 * Tuketici once konuya bakar: grubun dinlemedigi konu dogrulanmadan gecilir.
 * Boylece yeni bir konu (daha yeni bir ureticiden) eski tuketicide bozuk kayit
 * sayilmaz.
 */
export function peekEnvelope(fields: readonly string[]): EnvelopePeek {
  const values = fieldMap(fields);
  return {
    eventId: values.get(FIELD.EVENT_ID),
    topic: values.get(FIELD.TOPIC),
    requestId: values.get(FIELD.REQUEST_ID),
  };
}

/**
 * XRANGE / XREADGROUP kaydindan zarf. Stream dis veridir: semadan gecer.
 * @throws AppError INTERNAL - kayit zarf bicimine uymuyor.
 */
export function fromStreamFields(fields: readonly string[]): EventEnvelope {
  const values = fieldMap(fields);
  const payloadText = values.get(FIELD.PAYLOAD);
  const parsed = eventEnvelopeSchema.safeParse({
    eventId: values.get(FIELD.EVENT_ID),
    topic: values.get(FIELD.TOPIC),
    partitionKey: values.get(FIELD.PARTITION_KEY),
    occurredAt: values.get(FIELD.OCCURRED_AT),
    payload: payloadText === undefined ? undefined : parseJson(payloadText),
    // Bicimsiz korelasyon alani atilir, olay yine islenir: istege bagli ust veri
    // yuzunden gecerli bir olay olu olaylara gitmesin.
    ...validCorrelation({
      requestId: values.get(FIELD.REQUEST_ID),
      traceparent: values.get(FIELD.TRACEPARENT),
    }),
  });
  if (!parsed.success) {
    throw AppError.internal('Stream kaydi olay zarfina uymuyor', {
      details: { issues: parsed.error.issues.map((issue) => issue.path.join('.')) },
    });
  }
  return parsed.data;
}

function fieldMap(fields: readonly string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index + 1 < fields.length; index += 2) {
    values.set(fields[index] ?? '', fields[index + 1] ?? '');
  }
  return values;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
