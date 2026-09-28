/**
 * Tek akis kaydinin kaderi (T7.4): isleyiciye verilir mi, onaylanir mi,
 * yeniden mi denenir, olu olaylara mi gider? Redis'e DOKUNMAZ; karari
 * uygulamak (XACK, XADD) group-worker'in isidir. Boylece kurallar agsiz test
 * edilir.
 */

import { isAppError } from '@getir/core';
import type { Logger } from '@getir/core';

import { DEAD_LETTER_REASON } from './dead-letter.js';
import type { DeadLetterReason } from './dead-letter.js';
import type { EventEnvelope } from './envelope.js';
import { fromStreamFields, peekEnvelope } from './stream-fields.js';
import type { EventHandler } from './subscriber.js';

export interface StreamEntry {
  /** Redis akis kimligi ("1790580376790-0"). */
  readonly id: string;
  /** Duz alan listesi; null: kayit islenmeden akistan kirpilmis (MAXLEN). */
  readonly fields: readonly string[] | null;
}

export type Settlement =
  | { readonly kind: 'handled' }
  /** Grubun dinledigi konu degil: onaylanip gecilir. */
  | { readonly kind: 'skipped' }
  /** Gecici hata: onaylanmaz, takilma suresinden sonra yeniden teslim edilir. */
  | { readonly kind: 'retry'; readonly error: unknown }
  | {
      readonly kind: 'dead';
      readonly reason: DeadLetterReason;
      /** Isleyiciye kac kez verildi (kayda yazilir); bozuk ya da kirpilmis kayitta 0. */
      readonly attempts: number;
      readonly error: string;
    };

export interface DispatchContext {
  /** Bu teslimin sirasi: 1 ilk teslim, takilandan alinan kayitta onceki teslim + 1. */
  readonly attempt: number;
  readonly maxDeliveries: number;
  readonly handlerFor: (topic: string) => EventHandler | undefined;
  /** Grup bagli gunlukcu; isleyiciye olay alanlari eklenerek verilir. */
  readonly logger: Logger;
}

const HANDLED: Settlement = { kind: 'handled' };
const SKIPPED: Settlement = { kind: 'skipped' };

export async function dispatchEntry(
  entry: StreamEntry,
  context: DispatchContext,
): Promise<Settlement> {
  if (entry.fields === null) {
    return dead(DEAD_LETTER_REASON.TRIMMED, 0, 'kayit islenmeden akistan kirpildi');
  }
  const { topic } = peekEnvelope(entry.fields);
  if (topic === undefined) {
    // Konusu olmayan kayit hicbir grubun degildir; sessizce gecilirse kaybolur.
    return dead(DEAD_LETTER_REASON.MALFORMED, 0, 'kayitta konu alani yok');
  }
  const handler = context.handlerFor(topic);
  if (handler === undefined) {
    return SKIPPED;
  }

  let envelope: EventEnvelope;
  try {
    envelope = fromStreamFields(entry.fields);
  } catch (error: unknown) {
    return dead(DEAD_LETTER_REASON.MALFORMED, 0, describeError(error));
  }

  if (context.attempt > context.maxDeliveries) {
    // Onceki teslimler yarim kaldi (tuketici coktu ya da isleyici takildi): isleyiciyi
    // her seferinde cokerten kayit sonsuza dek donmesin diye bir daha VERILMEZ.
    return dead(
      DEAD_LETTER_REASON.EXHAUSTED,
      context.attempt - 1,
      'deneme hakki onceki teslimlerde bitti; isleyiciye verilmedi',
    );
  }

  const logger = context.logger.child({
    eventId: envelope.eventId,
    topic: envelope.topic,
    attempt: context.attempt,
  });
  try {
    const outcome = await handler(envelope, { attempt: context.attempt, logger });
    return outcome.kind === 'handled'
      ? HANDLED
      : dead(DEAD_LETTER_REASON.REJECTED, context.attempt, rejectionText(outcome));
  } catch (error: unknown) {
    return context.attempt >= context.maxDeliveries
      ? dead(DEAD_LETTER_REASON.EXHAUSTED, context.attempt, describeError(error))
      : { kind: 'retry', error };
  }
}

function dead(reason: DeadLetterReason, attempts: number, error: string): Settlement {
  return { kind: 'dead', reason, attempts, error };
}

function rejectionText(outcome: { readonly reason: string; readonly cause?: unknown }): string {
  return outcome.cause === undefined
    ? outcome.reason
    : `${outcome.reason}: ${describeError(outcome.cause)}`;
}

/** Olu olay kaydina yazilacak metin: mesaj ve (varsa) AppError ayrintisi. */
export function describeError(error: unknown): string {
  if (isAppError(error) && error.details !== undefined) {
    return `${error.message} ${JSON.stringify(error.details)}`;
  }
  return error instanceof Error ? error.message : String(error);
}
