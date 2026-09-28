/**
 * Olu olay kaydinin alan duzeni (T7.4): orijinal alanlar aynen, ust veri
 * `dead.` onekiyle. Elle yeniden oynatma bu duzene dayanir (README).
 */

import { describe, expect, it } from 'vitest';

import {
  DEAD_LETTER_ERROR_MAX_LENGTH,
  DEAD_LETTER_FIELD,
  DEAD_LETTER_REASON,
  toDeadLetterFields,
} from '../../src/dead-letter.js';
import type { DeadLetter } from '../../src/dead-letter.js';
import { fromStreamFields, toStreamFields } from '../../src/stream-fields.js';
import { envelopeOf } from '../support/envelopes.js';

const letter: DeadLetter = {
  sourceId: '1790580376790-0',
  group: 'payment',
  consumer: 'host-42',
  reason: DEAD_LETTER_REASON.REJECTED,
  attempts: 1,
  error: 'Odeme bulunamadi',
  at: new Date('2026-09-28T10:00:01.000Z'),
};

function asMap(fields: readonly string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index + 1 < fields.length; index += 2) {
    values.set(fields[index] ?? '', fields[index + 1] ?? '');
  }
  return values;
}

describe('toDeadLetterFields', () => {
  it('orijinal alanlar aynen korunur; zarf kayittan yeniden okunabilir', () => {
    const envelope = envelopeOf();
    const original = toStreamFields(envelope);

    const fields = toDeadLetterFields(original, letter);

    expect(fields.slice(0, original.length)).toEqual(original);
    expect(fromStreamFields(fields)).toEqual(envelope);
  });

  it('ust veri dead. onekiyle eklenir', () => {
    const values = asMap(toDeadLetterFields(toStreamFields(envelopeOf()), letter));

    expect(values.get(DEAD_LETTER_FIELD.SOURCE_ID)).toBe('1790580376790-0');
    expect(values.get(DEAD_LETTER_FIELD.GROUP)).toBe('payment');
    expect(values.get(DEAD_LETTER_FIELD.CONSUMER)).toBe('host-42');
    expect(values.get(DEAD_LETTER_FIELD.REASON)).toBe('rejected');
    expect(values.get(DEAD_LETTER_FIELD.ATTEMPTS)).toBe('1');
    expect(values.get(DEAD_LETTER_FIELD.ERROR)).toBe('Odeme bulunamadi');
    expect(values.get(DEAD_LETTER_FIELD.AT)).toBe('2026-09-28T10:00:01.000Z');
  });

  it('yeniden oynatilip tekrar olen kayitta eski dead. alanlari atilir (her ust veri bir kez)', () => {
    const once = toDeadLetterFields(toStreamFields(envelopeOf()), letter);

    const twice = toDeadLetterFields(once, { ...letter, attempts: 5 });

    expect(twice.filter((name) => name === DEAD_LETTER_FIELD.ATTEMPTS)).toHaveLength(1);
    expect(asMap(twice).get(DEAD_LETTER_FIELD.ATTEMPTS)).toBe('5');
  });

  it('uzun hata metni kisaltilir', () => {
    const values = asMap(toDeadLetterFields(null, { ...letter, error: 'x'.repeat(2_000) }));

    expect(values.get(DEAD_LETTER_FIELD.ERROR)).toHaveLength(DEAD_LETTER_ERROR_MAX_LENGTH);
  });

  it('kirpilmis kayit (alan yok): yalnizca ust veri', () => {
    const fields = toDeadLetterFields(null, { ...letter, reason: DEAD_LETTER_REASON.TRIMMED });

    expect(fields.filter((_, index) => index % 2 === 0)).toEqual(Object.values(DEAD_LETTER_FIELD));
  });
});
