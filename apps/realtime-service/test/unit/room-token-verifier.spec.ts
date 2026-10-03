import { REALTIME_TOKEN } from '@getir/contracts';
import { fixedClock } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { TOKEN_CLOCK_TOLERANCE_SECONDS } from '../../src/config/constants.js';
import {
  createRoomTokenVerifier,
  disabledRoomTokenVerifier,
  TOKEN_INVALID_REASON,
} from '../../src/infrastructure/room-token-verifier.js';
import {
  ORDER_ROOM,
  OTHER_SECRET,
  signRoomToken,
  TEST_SECRET,
  unsignedToken,
  USER_ID,
} from '../support/tokens.js';

const NOW_MS = Date.UTC(2026, 9, 3, 12, 0, 0);
const clock = fixedClock(NOW_MS);
const verifier = createRoomTokenVerifier({ secret: TEST_SECRET, clock });

/** HS512 imzasi icin anahtar en az 64 bayt olmali (jose). */
const LONG_SECRET = TEST_SECRET.repeat(2);

describe('createRoomTokenVerifier', () => {
  it('gateway bicimindeki jetonu kabul eder: kullanici ve oda doner', async () => {
    const token = await signRoomToken(NOW_MS);

    await expect(verifier.verify(token)).resolves.toEqual({
      status: 'valid',
      grant: { userId: USER_ID, room: ORDER_ROOM },
    });
  });

  it('saat kaymasi payi icinde suresi gecmis jetonu kabul eder', async () => {
    const token = await signRoomToken(NOW_MS, {
      issuedAt: Math.floor(NOW_MS / 1000) - REALTIME_TOKEN.TTL_SECONDS - 2,
    });

    await expect(verifier.verify(token)).resolves.toMatchObject({ status: 'valid' });
  });

  it.each([
    ['suresi dolmus', { issuedAt: Math.floor(NOW_MS / 1000) - 120 }, 'ERR_JWT_EXPIRED'],
    ['baska sirla imzali', { secret: OTHER_SECRET }, 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED'],
    ['HS512', { algorithm: 'HS512', secret: LONG_SECRET }, 'ERR_JOSE_ALG_NOT_ALLOWED'],
    ['alicisi yanlis', { audience: 'gateway' }, 'ERR_JWT_CLAIM_VALIDATION_FAILED'],
    ['alicisiz (erisim jetonu gibi)', { audience: null }, 'ERR_JWT_CLAIM_VALIDATION_FAILED'],
    ['vericisi yanlis', { issuer: 'baska-sistem' }, 'ERR_JWT_CLAIM_VALIDATION_FAILED'],
    ['exp yok', { ttlSeconds: null }, 'ERR_JWT_CLAIM_VALIDATION_FAILED'],
    ['iat yok', { issuedAt: null }, 'ERR_JWT_CLAIM_VALIDATION_FAILED'],
    ['oda alani yok', { room: null }, 'ERR_JWT_CLAIM_VALIDATION_FAILED'],
    ['sub yok', { subject: null }, 'ERR_JWT_CLAIM_VALIDATION_FAILED'],
  ] as const)('%s jetonu reddeder (%s)', async (_name, overrides, reason) => {
    const token = await signRoomToken(NOW_MS, overrides);

    await expect(verifier.verify(token)).resolves.toEqual({ status: 'invalid', reason });
  });

  it('uzun omurlu jetonu (exp ileride ama iat eski) reddeder', async () => {
    // Sizan bir sirla uretilmis 1 saatlik jeton: exp gecerli, iat cok eski.
    const issuedAt =
      Math.floor(NOW_MS / 1000) - REALTIME_TOKEN.TTL_SECONDS - TOKEN_CLOCK_TOLERANCE_SECONDS - 1;
    const token = await signRoomToken(NOW_MS, { issuedAt, ttlSeconds: 3600 });

    // jose, iat'in fazla eski olmasini da "suresi dolmus" sayar.
    await expect(verifier.verify(token)).resolves.toEqual({
      status: 'invalid',
      reason: 'ERR_JWT_EXPIRED',
    });
  });

  it("omru 60 sn'den uzun jetonu reddeder (exp - iat > TTL; QA 22)", async () => {
    const token = await signRoomToken(NOW_MS, { ttlSeconds: REALTIME_TOKEN.TTL_SECONDS + 1 });

    await expect(verifier.verify(token)).resolves.toEqual({
      status: 'invalid',
      reason: TOKEN_INVALID_REASON.LIFETIME,
    });
  });

  it('iat saat payinin otesinde gelecekteyse reddeder (QA 21)', async () => {
    const issuedAt = Math.floor(NOW_MS / 1000) + TOKEN_CLOCK_TOLERANCE_SECONDS + 5;
    const token = await signRoomToken(NOW_MS, { issuedAt });

    await expect(verifier.verify(token)).resolves.toEqual({
      status: 'invalid',
      reason: 'ERR_JWT_CLAIM_VALIDATION_FAILED',
    });
  });

  it('nbf gelecekteyse reddeder (QA 21)', async () => {
    const token = await signRoomToken(NOW_MS, {
      notBefore: Math.floor(NOW_MS / 1000) + TOKEN_CLOCK_TOLERANCE_SECONDS + 5,
    });

    await expect(verifier.verify(token)).resolves.toEqual({
      status: 'invalid',
      reason: 'ERR_JWT_CLAIM_VALIDATION_FAILED',
    });
  });

  it('ayni jeton birden cok kez dogrulanabilir (jti yok; QA 23)', async () => {
    const token = await signRoomToken(NOW_MS);

    await expect(verifier.verify(token)).resolves.toMatchObject({ status: 'valid' });
    await expect(verifier.verify(token)).resolves.toMatchObject({ status: 'valid' });
  });

  it('imzasiz ("alg: none") jetonu reddeder', async () => {
    await expect(verifier.verify(unsignedToken(NOW_MS))).resolves.toMatchObject({
      status: 'invalid',
    });
  });

  it.each([
    ['sub bicim disi', { subject: 'kullanici-1' }],
    ['sub baska onekli', { subject: 'ord_0123456789abcdef0123456789abcdef' }],
    ['oda market odasi', { room: 'store:mkt_migros-jet-moda' }],
  ])('%s ise alanlari reddeder', async (_name, overrides) => {
    const token = await signRoomToken(NOW_MS, overrides);

    await expect(verifier.verify(token)).resolves.toEqual({
      status: 'invalid',
      reason: TOKEN_INVALID_REASON.CLAIMS,
    });
  });

  it.each(['', 'jeton-degil', 'a.b.c'])(
    'JWT olmayan metni (%j) hata firlatmadan reddeder',
    async (token) => {
      await expect(verifier.verify(token)).resolves.toMatchObject({ status: 'invalid' });
    },
  );
});

describe('disabledRoomTokenVerifier', () => {
  it('sir yokken her jeton icin disabled doner', async () => {
    const token = await signRoomToken(NOW_MS);

    await expect(disabledRoomTokenVerifier.verify(token)).resolves.toEqual({ status: 'disabled' });
  });
});
