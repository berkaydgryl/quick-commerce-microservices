/**
 * Satirlari kaydeden gunlukcu (D5): alt gunlukcu alanlari pino'nun child'i
 * gibi birlesir. Testler "hangi satir, hangi seviyede, hangi baglamla
 * yazildi" sorusunu bununla cevaplar (orn. use-case satirinin requestId
 * tasimasi, D2). Once dort ayri kopyasi vardi: payment (iki), risk, event-bus.
 */

import type { LogFields, Logger } from '../logger.js';

/** Logger arayuzunun yazabildigi seviyeler. */
export type RecordedLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogLine {
  readonly level: RecordedLevel;
  /** Alt gunlukcu alanlari + satirin kendi alanlari (satirinki ustun). */
  readonly fields: LogFields;
  readonly message: string;
}

/** Satirlari verilen diziye ekler; `bound` alt gunlukcunun baglamidir. */
export function recordingLogger(lines: LogLine[], bound: LogFields = {}): Logger {
  const write =
    (level: RecordedLevel) =>
    (fields: LogFields, message: string): void => {
      lines.push({ level, fields: { ...bound, ...fields }, message });
    };
  return {
    debug: write('debug'),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
    fatal: write('fatal'),
    child: (fields) => recordingLogger(lines, { ...bound, ...fields }),
  };
}
