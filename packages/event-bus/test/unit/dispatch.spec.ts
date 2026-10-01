/**
 * Tek akis kaydinin kaderi (T7.4): Redis'siz, yalnizca karar kurallari.
 */

import { AppError, EVENTS, silentLogger } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { DEAD_LETTER_REASON } from '../../src/dead-letter.js';
import { dispatchEntry } from '../../src/dispatch.js';
import type { DispatchContext } from '../../src/dispatch.js';
import { toStreamFields } from '../../src/stream-fields.js';
import { EVENT_HANDLED, rejectEvent } from '../../src/subscriber.js';
import type { EventHandler } from '../../src/subscriber.js';
import { entryOf, envelopeOf } from '../support/envelopes.js';

const MAX_DELIVERIES = 3;

/** Grup yalnizca iade komutunu dinler. */
function contextFor(
  handler: EventHandler,
  overrides: Partial<DispatchContext> = {},
): DispatchContext {
  return {
    attempt: 1,
    maxDeliveries: MAX_DELIVERIES,
    handlerFor: (topic) => (topic === EVENTS.PAYMENT_REFUND_REQUESTED ? handler : undefined),
    group: 'payment',
    logger: silentLogger,
    ...overrides,
  };
}

const handled = (): EventHandler => vi.fn<EventHandler>(() => Promise.resolve(EVENT_HANDLED));
const failing = (error: unknown): EventHandler =>
  vi.fn<EventHandler>(() => Promise.reject(error instanceof Error ? error : new Error('hata')));

describe('dispatchEntry: isleyiciye giden kayit', () => {
  it('islenen olay: zarf ayristirilmis ve deneme sirasiyla verilir', async () => {
    const envelope = envelopeOf();
    const handler = handled();

    const settlement = await dispatchEntry(entryOf('1-0', envelope), contextFor(handler));

    expect(settlement).toEqual({ kind: 'handled' });
    expect(handler).toHaveBeenCalledWith(envelope, expect.objectContaining({ attempt: 1 }));
  });

  it('isleyicinin gunlukcusu olay kimligi, konu, deneme ve olayi doguran istegin kimligini tasir', async () => {
    const lines: LogLine[] = [];
    const envelope = { ...envelopeOf(), requestId: `req_${'7'.repeat(32)}` as const };
    const handler: EventHandler = (_envelope, { logger }) => {
      logger.info({}, 'isleniyor');
      return Promise.resolve(EVENT_HANDLED);
    };

    await dispatchEntry(
      entryOf('1-0', envelope),
      contextFor(handler, { attempt: 2, logger: recordingLogger(lines, { group: 'payment' }) }),
    );

    expect(lines[0]?.fields).toEqual({
      group: 'payment',
      eventId: envelope.eventId,
      topic: envelope.topic,
      attempt: 2,
      requestId: envelope.requestId,
    });
  });

  it('zarfta requestId yoksa (eski kayit, istek disi uretici) tuketici yenisini uretir (D16)', async () => {
    const lines: LogLine[] = [];
    const handler: EventHandler = (_envelope, { logger }) => {
      logger.info({}, 'isleniyor');
      return Promise.resolve(EVENT_HANDLED);
    };

    await dispatchEntry(entryOf('1-0'), contextFor(handler, { logger: recordingLogger(lines) }));

    expect(lines[0]?.fields['requestId']).toMatch(/^req_[0-9a-f]{32}$/);
  });
});

describe('dispatchEntry: grubun olmayan kayit', () => {
  it('dinlenmeyen konu atlanir, isleyici cagrilmaz', async () => {
    const handler = handled();

    const settlement = await dispatchEntry(
      entryOf('1-0', envelopeOf(EVENTS.ORDER_CREATED)),
      contextFor(handler),
    );

    expect(settlement).toEqual({ kind: 'skipped' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('sozlukte olmayan (daha yeni ureticiden) konu bozuk sayilmaz, atlanir', async () => {
    const fields = toStreamFields(envelopeOf());
    fields[3] = 'order.yeni_bir_olay';

    await expect(dispatchEntry({ id: '1-0', fields }, contextFor(handled()))).resolves.toEqual({
      kind: 'skipped',
    });
  });
});

describe('dispatchEntry: olu olaylara giden kayit', () => {
  it('isleyici reddederse beklemeden: gerekce ve sebep metni yazilir', async () => {
    const cause = AppError.notFound('Odeme bulunamadi', { details: { orderId: 'ord_1' } });
    const handler: EventHandler = () => Promise.resolve(rejectEvent('iade yapilamaz', cause));

    await expect(dispatchEntry(entryOf('1-0'), contextFor(handler))).resolves.toEqual({
      kind: 'dead',
      reason: DEAD_LETTER_REASON.REJECTED,
      attempts: 1,
      error: 'iade yapilamaz: Odeme bulunamadi {"orderId":"ord_1"}',
    });
  });

  it('gecici hata son hakta: max_deliveries', async () => {
    const settlement = await dispatchEntry(
      entryOf('1-0'),
      contextFor(failing(new Error('mongo kapali')), { attempt: MAX_DELIVERIES }),
    );

    expect(settlement).toEqual({
      kind: 'dead',
      reason: DEAD_LETTER_REASON.EXHAUSTED,
      attempts: MAX_DELIVERIES,
      error: 'mongo kapali',
    });
  });

  it('hakki onceki teslimlerde bitmis kayit isleyiciye HIC verilmez', async () => {
    // Isleyiciyi her seferinde cokerten kayit sonsuza dek donmesin.
    const handler = handled();

    const settlement = await dispatchEntry(
      entryOf('1-0'),
      contextFor(handler, { attempt: MAX_DELIVERIES + 1 }),
    );

    expect(settlement).toMatchObject({
      kind: 'dead',
      reason: DEAD_LETTER_REASON.EXHAUSTED,
      attempts: MAX_DELIVERIES,
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('zarfa uymayan kayit: malformed, isleyici cagrilmaz', async () => {
    const fields = toStreamFields(envelopeOf());
    fields[9] = '{bozuk json';
    const handler = handled();

    const settlement = await dispatchEntry({ id: '1-0', fields }, contextFor(handler));

    expect(settlement).toMatchObject({
      kind: 'dead',
      reason: DEAD_LETTER_REASON.MALFORMED,
      attempts: 0,
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('konu alani olmayan kayit hicbir grubun degil: sessizce gecilmez, malformed', async () => {
    await expect(
      dispatchEntry({ id: '1-0', fields: ['eventId', 'evt_x'] }, contextFor(handled())),
    ).resolves.toMatchObject({ kind: 'dead', reason: DEAD_LETTER_REASON.MALFORMED });
  });

  it('akistan kirpilmis kayit (alan yok): trimmed', async () => {
    await expect(
      dispatchEntry({ id: '1-0', fields: null }, contextFor(handled())),
    ).resolves.toMatchObject({ kind: 'dead', reason: DEAD_LETTER_REASON.TRIMMED, attempts: 0 });
  });
});

describe('dispatchEntry: yeniden denenecek kayit', () => {
  it('gecici hata ve hak var: retry, hata tasinir', async () => {
    const error = new Error('mongo kapali');

    const settlement = await dispatchEntry(
      entryOf('1-0'),
      contextFor(failing(error), { attempt: MAX_DELIVERIES - 1 }),
    );

    expect(settlement).toEqual({ kind: 'retry', error });
  });
});
