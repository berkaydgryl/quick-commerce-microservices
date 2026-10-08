/**
 * Odemenin 3DS durumu (#163 B1): saf kural. Jeton yalnizca dogrulama ACIKKEN;
 * kalan hak kapanma sebebinden bagimsiz; dogrulama yoksa ya da odeme 3DS
 * disinda sonuclandiysa durum yok. Sinirin iki yani: bitis aninda 1 ms once/an.
 */

import { fixedClock } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { THREEDS_CLOSE_REASON } from '../../src/domain/payment.js';
import type { Payment, ThreeDsChallenge } from '../../src/domain/payment.js';
import { threeDsViewOf } from '../../src/domain/three-ds-view.js';

const MAX = 3;
const NOW = Date.parse('2026-10-08T09:00:00.000Z');
const EXPIRES = new Date(NOW + 30_000);
const ID = `tds_${'b'.repeat(32)}`;

function payment(status: Payment['status'], challenge?: Partial<ThreeDsChallenge>): Payment {
  return {
    id: `pay_${'c'.repeat(32)}`,
    orderId: `ord_${'d'.repeat(32)}`,
    userId: `usr_${'e'.repeat(32)}`,
    amount: { amountMinor: 12_990, currency: 'TRY' },
    method: 'CARD',
    status,
    attempts: [],
    idempotencyKey: 'anahtar-3ds-0001',
    version: 1,
    createdAt: new Date(NOW - 10_000),
    updatedAt: new Date(NOW - 10_000),
    ...(challenge === undefined
      ? {}
      : { challenge: { id: ID, expiresAt: EXPIRES, failedAttempts: 0, ...challenge } }),
  };
}

const at = (ms: number) => fixedClock(ms);

describe('threeDsViewOf', () => {
  it('acik: REQUIRES_3DS, sure ve hak var -> jeton, bitis, kalan hak', () => {
    expect(threeDsViewOf(payment('REQUIRES_3DS', {}), MAX, at(NOW))).toEqual({
      challengeId: ID,
      expiresAt: EXPIRES,
      attemptsLeft: 3,
    });
    expect(
      threeDsViewOf(payment('REQUIRES_3DS', { failedAttempts: 2 }), MAX, at(NOW))?.attemptsLeft,
    ).toBe(1);
  });

  it('sure siniri: bitisten 1 ms once acik (jeton var), bitis aninda kapali (jeton yok, hak kalir)', () => {
    const waiting = payment('REQUIRES_3DS', { failedAttempts: 1 });

    expect(threeDsViewOf(waiting, MAX, at(EXPIRES.getTime() - 1))?.challengeId).toBe(ID);
    expect(threeDsViewOf(waiting, MAX, at(EXPIRES.getTime()))).toEqual({
      expiresAt: EXPIRES,
      attemptsLeft: 2,
    });
  });

  it('hak siniri: 1 hak acik, 0 hak kapali; hak hic negatif olmaz', () => {
    expect(
      threeDsViewOf(payment('REQUIRES_3DS', { failedAttempts: 2 }), MAX, at(NOW))?.challengeId,
    ).toBe(ID);
    expect(threeDsViewOf(payment('REQUIRES_3DS', { failedAttempts: 3 }), MAX, at(NOW))).toEqual({
      expiresAt: EXPIRES,
      attemptsLeft: 0,
    });
    expect(
      threeDsViewOf(payment('REQUIRES_3DS', { failedAttempts: 9 }), MAX, at(NOW))?.attemptsLeft,
    ).toBe(0);
  });

  it.each([
    ['hakki bitip kapanmis', THREEDS_CLOSE_REASON.ATTEMPTS_EXHAUSTED, 3, 0],
    ['suresi dolup kapanmis (hak kalir)', THREEDS_CLOSE_REASON.EXPIRED, 1, 2],
    ['suresi dolup kapanmis, hic yanlis kod yok (tum hak)', THREEDS_CLOSE_REASON.EXPIRED, 0, MAX],
  ])('FAILED ve %s: durum var, jeton YOK', (_name, closedReason, failedAttempts, attemptsLeft) => {
    expect(
      threeDsViewOf(payment('FAILED', { closedReason, failedAttempts }), MAX, at(NOW)),
    ).toEqual({ expiresAt: EXPIRES, attemptsLeft });
  });

  it.each([
    ['dogrulama hic yok (kartla dogrudan onay)', payment('SUCCEEDED')],
    ['dogrulama sonrasi basarili', payment('SUCCEEDED', {})],
    ['iade edilmis', payment('REFUNDED', {})],
    ['iptal edilmis', payment('CANCELLED', {})],
    ['3DS disi sebeple FAILED (kapanmamis dogrulama)', payment('FAILED', {})],
    ['kapida odeme', payment('PENDING')],
  ])('%s: durum YOK', (_name, value) => {
    expect(threeDsViewOf(value, MAX, at(NOW))).toBeUndefined();
  });

  it('REQUIRES_3DS ama dogrulama kapanmis isaretli (tutarsiz kayit): durum var, jeton YOK', () => {
    expect(
      threeDsViewOf(
        payment('REQUIRES_3DS', { closedReason: THREEDS_CLOSE_REASON.EXPIRED }),
        MAX,
        at(NOW),
      ),
    ).toEqual({ expiresAt: EXPIRES, attemptsLeft: MAX });
  });

  it('hak siniri ayari sonradan ARTSA da hakki bitip kapanmis dogrulama 0 hak (hakki bitti) kalir', () => {
    const exhausted = payment('FAILED', {
      closedReason: THREEDS_CLOSE_REASON.ATTEMPTS_EXHAUSTED,
      failedAttempts: 3,
    });

    expect(threeDsViewOf(exhausted, 5, at(NOW))?.attemptsLeft).toBe(0);
  });
});
