/**
 * @getir/core/testing recordingLogger (D5): satirlar seviye, birlesmis alanlar
 * ve mesajla kaydedilir; alt gunlukcu baglami pino'nun child'i gibi eklenir.
 */

import { describe, expect, it } from 'vitest';

import { recordingLogger } from '../../src/testing/index.js';
import type { LogLine } from '../../src/testing/index.js';

describe('recordingLogger', () => {
  it('her seviyeyi siraya gore kaydeder', () => {
    const lines: LogLine[] = [];
    const logger = recordingLogger(lines);

    logger.debug({ a: 1 }, 'bir');
    logger.info({}, 'iki');
    logger.warn({}, 'uc');
    logger.error({}, 'dort');
    logger.fatal({}, 'bes');

    expect(lines.map((line) => [line.level, line.message])).toEqual([
      ['debug', 'bir'],
      ['info', 'iki'],
      ['warn', 'uc'],
      ['error', 'dort'],
      ['fatal', 'bes'],
    ]);
    expect(lines[0]?.fields).toEqual({ a: 1 });
  });

  it('alt gunlukcu alanlari birikir; satirin kendi alani ustun gelir', () => {
    const lines: LogLine[] = [];
    const logger = recordingLogger(lines, { service: 'payment' })
      .child({ rpc: 'Charge', requestId: 'req_1' })
      .child({ requestId: 'req_2' });

    logger.warn({ orderId: 'ord_1', rpc: 'Refund' }, 'is hatasi');

    expect(lines).toEqual([
      {
        level: 'warn',
        fields: { service: 'payment', rpc: 'Refund', requestId: 'req_2', orderId: 'ord_1' },
        message: 'is hatasi',
      },
    ]);
  });
});
