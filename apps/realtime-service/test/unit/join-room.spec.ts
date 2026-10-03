import { fixedClock } from '@getir/core';
import { describe, expect, it, vi } from 'vitest';

import { createJoinRateLimiter } from '../../src/application/join-rate-limit.js';
import type { JoinRateLimiter } from '../../src/application/join-rate-limit.js';
import { createJoinRoom } from '../../src/application/join-room.js';
import type { RoomTokenVerifier } from '../../src/application/join-room.js';
import { JOIN_RATE_LIMIT } from '../../src/config/constants.js';
import { ORDER_ROOM, OTHER_ORDER_ROOM, STORE_ROOM, USER_ID } from '../support/tokens.js';

const unlimited: JoinRateLimiter = { tryAcquire: () => true };

function verifierFor(room: string): RoomTokenVerifier & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    verify: (token) => {
      calls.push(token);
      return Promise.resolve(
        token === 'gecerli'
          ? { status: 'valid', grant: { userId: USER_ID, room } }
          : { status: 'invalid', reason: 'ERR_JWS_INVALID' },
      );
    },
  };
}

describe('createJoinRoom', () => {
  it('market odasina jetonsuz katilir ve jetona bakmaz', async () => {
    const verifier = verifierFor(ORDER_ROOM);
    const joinRoom = createJoinRoom({ verifier });

    const result = await joinRoom({
      payload: { room: STORE_ROOM, token: 'gecerli' },
      limiter: unlimited,
    });

    expect(result).toMatchObject({ ok: true, room: { kind: 'store', name: STORE_ROOM } });
    expect(verifier.calls).toEqual([]);
  });

  it('siparis odasina gecerli jetonla katilir', async () => {
    const joinRoom = createJoinRoom({ verifier: verifierFor(ORDER_ROOM) });

    const result = await joinRoom({
      payload: { room: ORDER_ROOM, token: 'gecerli' },
      limiter: unlimited,
    });

    expect(result).toEqual({
      ok: true,
      room: expect.objectContaining({ name: ORDER_ROOM }) as unknown,
      grant: { userId: USER_ID, room: ORDER_ROOM },
    });
  });

  it.each([
    ['jetonsuz', { room: ORDER_ROOM }, 'token_missing', 'FORBIDDEN', undefined],
    [
      'gecersiz jetonla',
      { room: ORDER_ROOM, token: 'bozuk' },
      'token_invalid',
      'UNAUTHORIZED',
      'ERR_JWS_INVALID',
    ],
  ])('siparis odasina %s katilamaz', async (_name, payload, rejection, code, reason) => {
    const joinRoom = createJoinRoom({ verifier: verifierFor(ORDER_ROOM) });

    const result = await joinRoom({ payload, limiter: unlimited });

    expect(result).toEqual({
      ok: false,
      rejection,
      code,
      room: expect.objectContaining({ name: ORDER_ROOM }) as unknown,
      ...(reason === undefined ? {} : { reason }),
    });
  });

  it('baska siparisin jetonuyla katilamaz', async () => {
    const joinRoom = createJoinRoom({ verifier: verifierFor(OTHER_ORDER_ROOM) });

    const result = await joinRoom({
      payload: { room: ORDER_ROOM, token: 'gecerli' },
      limiter: unlimited,
    });

    expect(result).toMatchObject({
      ok: false,
      rejection: 'token_room_mismatch',
      code: 'UNAUTHORIZED',
    });
  });

  it.each([
    ['govde yok', undefined],
    ['govde metin', 'order:x'],
    ['oda yok', { token: 'gecerli' }],
    ['oda sayi', { room: 42 }],
    ['jeton sayi', { room: ORDER_ROOM, token: 42 }],
    ['bilinmeyen onek', { room: 'courier:1' }],
  ])('%s ise VALIDATION_FAILED doner', async (_name, payload) => {
    const verifier = verifierFor(ORDER_ROOM);
    const joinRoom = createJoinRoom({ verifier });

    const result = await joinRoom({ payload, limiter: unlimited });

    expect(result).toMatchObject({
      ok: false,
      rejection: 'invalid_payload',
      code: 'VALIDATION_FAILED',
    });
    expect(verifier.calls).toEqual([]);
  });

  it.each(['order:123', 'order:', 'store:', `store:mkt_${'a'.repeat(200)}`])(
    'bicim disi oda adi (%s) jetona bakilmadan VALIDATION_FAILED olur',
    async (room) => {
      const verifier = verifierFor(ORDER_ROOM);
      const joinRoom = createJoinRoom({ verifier });

      const result = await joinRoom({ payload: { room, token: 'gecerli' }, limiter: unlimited });

      expect(result).toEqual({
        ok: false,
        rejection: 'invalid_payload',
        code: 'VALIDATION_FAILED',
      });
      expect(verifier.calls).toEqual([]);
    },
  );

  it('bos metin jeton jetonsuz sayilir: FORBIDDEN (QA 20)', async () => {
    const verifier = verifierFor(ORDER_ROOM);
    const joinRoom = createJoinRoom({ verifier });

    const result = await joinRoom({ payload: { room: ORDER_ROOM, token: '' }, limiter: unlimited });

    expect(result).toMatchObject({ ok: false, rejection: 'token_missing', code: 'FORBIDDEN' });
    expect(verifier.calls).toEqual([]);
  });

  it('sinir dolunca jetona bakmadan RATE_LIMITED doner', async () => {
    const verifier = verifierFor(ORDER_ROOM);
    const joinRoom = createJoinRoom({ verifier });
    const limiter = { tryAcquire: vi.fn(() => false) };

    const result = await joinRoom({ payload: { room: ORDER_ROOM, token: 'gecerli' }, limiter });

    expect(result).toEqual({ ok: false, rejection: 'rate_limited', code: 'RATE_LIMITED' });
    expect(verifier.calls).toEqual([]);
  });

  it('bozuk govde de sinirdan sayilir', async () => {
    const joinRoom = createJoinRoom({ verifier: verifierFor(ORDER_ROOM) });
    const limiter = createJoinRateLimiter({
      maxAttempts: JOIN_RATE_LIMIT.MAX_ATTEMPTS,
      windowMs: JOIN_RATE_LIMIT.WINDOW_MS,
      clock: fixedClock(0),
    });

    for (let attempt = 0; attempt < JOIN_RATE_LIMIT.MAX_ATTEMPTS; attempt += 1) {
      await joinRoom({ payload: 'bozuk', limiter });
    }

    await expect(joinRoom({ payload: { room: STORE_ROOM }, limiter })).resolves.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });
});

describe('createJoinRateLimiter', () => {
  it('pencere basina en fazla MAX_ATTEMPTS deneme kabul eder, pencere kayinca yeniden acar', () => {
    const clock = fixedClock(0);
    const limiter = createJoinRateLimiter({ maxAttempts: 3, windowMs: 1_000, clock });

    expect([limiter.tryAcquire(), limiter.tryAcquire(), limiter.tryAcquire()]).toEqual([
      true,
      true,
      true,
    ]);
    expect(limiter.tryAcquire()).toBe(false);

    clock.advance(999);
    expect(limiter.tryAcquire()).toBe(false);

    // Pencere kaydi: ilk uc deneme cikti, uc yeni deneme acilir.
    clock.advance(1);
    expect([limiter.tryAcquire(), limiter.tryAcquire(), limiter.tryAcquire()]).toEqual([
      true,
      true,
      true,
    ]);
    expect(limiter.tryAcquire()).toBe(false);
  });

  it('reddedilen deneme sayilmaz: sure dolunca hemen acilir', () => {
    const clock = fixedClock(0);
    const limiter = createJoinRateLimiter({ maxAttempts: 1, windowMs: 1_000, clock });
    limiter.tryAcquire();

    for (let attempt = 0; attempt < 50; attempt += 1) {
      clock.advance(10);
      limiter.tryAcquire();
    }
    clock.advance(500);

    expect(limiter.tryAcquire()).toBe(true);
  });
});
