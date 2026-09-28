/**
 * Zarf <-> Redis Streams alanlari. Stream kaydi duz alan/deger ciftleridir;
 * payload JSON metni olarak tasinir. Ceviri tek yerde: yayinci yazar, tuketici
 * (T7.4) ayni fonksiyonla okur.
 */

import { AppError } from '@getir/core';

import { eventEnvelopeSchema } from './envelope.js';
import type { EventEnvelope } from './envelope.js';

const FIELD = {
  EVENT_ID: 'eventId',
  TOPIC: 'topic',
  PARTITION_KEY: 'partitionKey',
  OCCURRED_AT: 'occurredAt',
  PAYLOAD: 'payload',
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
  ];
}

/** Kaydin kimlik ve konu alanlari, DOGRULAMADAN (yonlendirme ve gunluk icin). */
export interface EnvelopePeek {
  readonly eventId: string | undefined;
  readonly topic: string | undefined;
}

/**
 * Tuketici once konuya bakar: grubun dinlemedigi konu dogrulanmadan gecilir.
 * Boylece yeni bir konu (daha yeni bir ureticiden) eski tuketicide bozuk kayit
 * sayilmaz.
 */
export function peekEnvelope(fields: readonly string[]): EnvelopePeek {
  const values = fieldMap(fields);
  return { eventId: values.get(FIELD.EVENT_ID), topic: values.get(FIELD.TOPIC) };
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
