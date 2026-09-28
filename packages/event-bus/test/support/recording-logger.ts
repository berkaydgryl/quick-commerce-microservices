/**
 * Satirlari kaydeden gunlukcu: alt gunlukcu alanlari pino'nun child'i gibi
 * birlesir. (payment ve risk log-context testlerindeki kopyalarla birlikte
 * D5'te ortak test yardimcisina tasinacak.)
 */

import type { LogFields, Logger } from '@getir/core';

export interface LogLine {
  readonly level: string;
  readonly fields: LogFields;
  readonly message: string;
}

export function recordingLogger(lines: LogLine[], bound: LogFields = {}): Logger {
  const write =
    (level: string) =>
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
