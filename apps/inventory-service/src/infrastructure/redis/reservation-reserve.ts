/**
 * reserve.lua'nin istemcisi (T10.1): anahtarlar (B15: once stok sayaclari, sonra
 * rezervasyon hash'i, sure indeksi ve kullanici kilidi), argumanlar ve cevabin
 * sonuca cevrilmesi.
 */

import { AppError } from '@getir/core';
import type { LuaScript } from '@getir/redis-kit';
import {
  reservationIndexKey,
  reservationKey,
  stockAvailKey,
  userReservationKey,
} from '@getir/redis-kit';

import { duplicateSku } from '../../domain/reservation.js';
import type { ReserveCommand, ReserveOutcome } from '../../domain/reservation.js';
import { reserveReplySchema } from './reservation-replies.js';

/** reserve.lua'nin depo ayarlarindan ihtiyaci (RedisReservationStoreOptions'in parcasi). */
export interface ReserveOptions {
  /** Hash'in bitisten sonra kalma payi (ms). */
  readonly holdAfterExpiryMs: number;
}

export async function runReserve(
  script: LuaScript,
  options: ReserveOptions,
  command: ReserveCommand,
): Promise<ReserveOutcome> {
  const { orderId, marketId, userId, lines, nowMs, ttlMs } = command;
  const repeated = duplicateSku(lines);
  if (repeated !== undefined) {
    throw AppError.internal('rezervasyonda tekrar eden sku', { details: { sku: repeated } });
  }

  const keys = [
    ...lines.map(({ sku }) => stockAvailKey(marketId, sku)),
    reservationKey(marketId, orderId),
    reservationIndexKey(marketId),
    userReservationKey(userId),
  ];
  const args = [
    orderId,
    userId,
    marketId,
    ttlMs,
    nowMs,
    options.holdAfterExpiryMs,
    ...lines.map(({ sku }) => sku),
    ...lines.map(({ quantity }) => quantity),
  ];

  const parsed = reserveReplySchema.safeParse(await script.run(keys, args));
  if (!parsed.success) {
    throw AppError.internal('reserve script beklenmeyen cevap verdi', {
      cause: parsed.error,
      details: { orderId, marketId },
    });
  }

  const reply = parsed.data;
  switch (reply[0]) {
    case 'reserved':
      return { status: 'reserved', expiresAt: reply[1] };
    case 'already':
      return { status: 'already-reserved', expiresAt: reply[1] };
    case 'user-active':
      return { status: 'user-has-active', activeOrderId: reply[1] };
    case 'insufficient': {
      const line = lineAt(command, reply[1]);
      return {
        status: 'insufficient',
        sku: line.sku,
        requested: line.quantity,
        counter: reply[2],
        counterMissing: false,
      };
    }
    case 'missing': {
      const line = lineAt(command, reply[1]);
      return {
        status: 'insufficient',
        sku: line.sku,
        requested: line.quantity,
        counter: 0,
        counterMissing: true,
      };
    }
    case 'corrupt':
      throw AppError.internal('stok sayaci bozuk', {
        details: { marketId, sku: lineAt(command, reply[1]).sku },
      });
  }
}

/** Script'in 1 tabanli kalem sirasi -> kalem; aralik disi INTERNAL. */
function lineAt(command: ReserveCommand, index: number) {
  const line = command.lines[index - 1];
  if (line === undefined) {
    throw AppError.internal('reserve script aralik disi kalem dondurdu', {
      details: { index, lines: command.lines.length },
    });
  }
  return line;
}
