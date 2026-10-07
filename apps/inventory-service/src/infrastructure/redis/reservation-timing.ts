/**
 * Sure script'lerinin istemcisi (T11.3, B21): lua/extend.lua (uzatma; hak sinirli)
 * ve lua/shorten.lua (kisaltma; asla uzatmaz). Kayit, indeks ve (varsa) kullanici
 * kilidi birlikte ilerler.
 */

import { AppError } from '@getir/core';
import type { LuaScript } from '@getir/redis-kit';
import { reservationIndexKey, reservationKey, userReservationKey } from '@getir/redis-kit';

import type {
  CommitCommand,
  ExtendCommand,
  ExtendOutcome,
  ShortenCommand,
  ShortenOutcome,
} from '../../domain/reservation.js';
import {
  extendReplySchema,
  inactiveOf,
  linesOf,
  shortenReplySchema,
} from './reservation-replies.js';
import type { ReservationHash } from './reservation-hash.js';

/** extend.lua ve shorten.lua'nin depo ayarlarindan ihtiyaci (RedisReservationStoreOptions'in parcasi). */
export interface TimingOptions {
  /** Hash'in bitisten sonra kalma payi (ms). */
  readonly holdAfterExpiryMs: number;
}

export async function extendOnce(
  script: LuaScript,
  options: TimingOptions,
  command: ExtendCommand,
  hash: ReservationHash | undefined,
): Promise<ExtendOutcome | 'stale'> {
  const { orderId, marketId, nowMs, additionalMs, maxExtensions, expectedExpiresAt } = command;
  const args = [
    orderId,
    hash?.userId ?? '',
    nowMs,
    additionalMs,
    options.holdAfterExpiryMs,
    maxExtensions,
    expectedExpiresAt ?? '',
  ];

  const parsed = extendReplySchema.safeParse(await script.run(timingKeys(command, hash), args));
  if (!parsed.success) {
    throw AppError.internal('extend script beklenmeyen cevap verdi', {
      cause: parsed.error,
      details: { orderId, marketId },
    });
  }

  const reply = parsed.data;
  switch (reply[0]) {
    case 'extended': {
      const [, expiresAt, extensionCount, ...pairs] = reply;
      return { status: 'extended', expiresAt, extensionCount, lines: linesOf(pairs, command) };
    }
    case 'limit':
      return { status: 'limit-reached', expiresAt: reply[1], extensionCount: reply[2] };
    case 'mismatch': {
      const [, expiresAt, extensionCount, ...pairs] = reply;
      return {
        status: 'expiry-mismatch',
        expiresAt,
        extensionCount,
        lines: linesOf(pairs, command),
      };
    }
    case 'stale':
      return 'stale';
    default:
      return inactiveOf(reply[0]);
  }
}

export async function shortenOnce(
  script: LuaScript,
  options: TimingOptions,
  command: ShortenCommand,
  hash: ReservationHash | undefined,
): Promise<ShortenOutcome | 'stale'> {
  const { orderId, marketId, nowMs, maxRemainingMs } = command;
  const args = [orderId, hash?.userId ?? '', nowMs, maxRemainingMs, options.holdAfterExpiryMs];

  const parsed = shortenReplySchema.safeParse(await script.run(timingKeys(command, hash), args));
  if (!parsed.success) {
    throw AppError.internal('shorten script beklenmeyen cevap verdi', {
      cause: parsed.error,
      details: { orderId, marketId },
    });
  }

  const reply = parsed.data;
  switch (reply[0]) {
    case 'shortened':
      return { status: 'shortened', expiresAt: reply[1] };
    case 'unchanged':
      return { status: 'unchanged', expiresAt: reply[1] };
    case 'stale':
      return 'stale';
    default:
      return inactiveOf(reply[0]);
  }
}

/** extend.lua ve shorten.lua'nin anahtarlari: kayit, indeks, (varsa) kullanici kilidi. */
function timingKeys(command: CommitCommand, hash: ReservationHash | undefined): string[] {
  return [
    reservationKey(command.marketId, command.orderId),
    reservationIndexKey(command.marketId),
    ...(hash === undefined ? [] : [userReservationKey(hash.userId)]),
  ];
}
