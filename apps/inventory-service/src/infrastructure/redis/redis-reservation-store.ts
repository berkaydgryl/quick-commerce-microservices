/**
 * Rezervasyonun Redis uygulamasi: lua/reserve.lua (T10.1, ADR-01).
 *
 * Anahtarlar redis-kit'in ureticilerinden gelir (bicim tek kaynakta); script'in
 * bekledigi sira B15'tedir: once stok sayaclari, sonra rezervasyon hash'i,
 * sure indeksi ve kullanici kilidi. SKU'lar ayri arguman olarak gecer; hash
 * alani qty:{sku} (B23).
 *
 * Script'in cevabi DIS VERIDIR (ADR-10): semadan gecer. Beklenmeyen cevap
 * ya da bozuk sayac tahminle islenmez, INTERNAL doner.
 */

import { AppError } from '@getir/core';
import type { LuaScript } from '@getir/redis-kit';
import {
  reservationIndexKey,
  reservationKey,
  stockAvailKey,
  userReservationKey,
} from '@getir/redis-kit';
import { z } from 'zod';

import { duplicateSku } from '../../domain/reservation.js';
import type { ReservationStore, ReserveCommand, ReserveOutcome } from '../../domain/reservation.js';

/** Lua tam sayisi ioredis'ten sayi, hash alani metin olarak gelir. */
const integerReply = z.union([
  z.number().int(),
  z
    .string()
    .regex(/^-?\d+$/)
    .transform(Number),
]);

/** Kalemin script'teki 1 tabanli sirasi. */
const lineIndex = integerReply.pipe(z.number().int().min(1));

const replySchema = z.union([
  z.tuple([z.literal('reserved'), integerReply]),
  z.tuple([z.literal('already'), integerReply]),
  z.tuple([z.literal('user-active'), z.string().min(1)]),
  z.tuple([z.literal('insufficient'), lineIndex, integerReply]),
  z.tuple([z.literal('missing'), lineIndex]),
  z.tuple([z.literal('corrupt'), lineIndex]),
]);

export interface RedisReservationStoreOptions {
  /** Hash'in bitisten sonra kalma payi (ms): supurucu gecikmeli tick'te okuyabilsin. */
  readonly holdAfterExpiryMs: number;
}

export class RedisReservationStore implements ReservationStore {
  constructor(
    private readonly script: LuaScript,
    private readonly options: RedisReservationStoreOptions,
  ) {}

  async reserve(command: ReserveCommand): Promise<ReserveOutcome> {
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
      this.options.holdAfterExpiryMs,
      ...lines.map(({ sku }) => sku),
      ...lines.map(({ quantity }) => quantity),
    ];

    const parsed = replySchema.safeParse(await this.script.run(keys, args));
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
        const line = this.lineAt(command, reply[1]);
        return {
          status: 'insufficient',
          sku: line.sku,
          requested: line.quantity,
          counter: reply[2],
          counterMissing: false,
        };
      }
      case 'missing': {
        const line = this.lineAt(command, reply[1]);
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
          details: { marketId, sku: this.lineAt(command, reply[1]).sku },
        });
    }
  }

  /** Script'in 1 tabanli kalem sirasi -> kalem; aralik disi INTERNAL. */
  private lineAt(command: ReserveCommand, index: number) {
    const line = command.lines[index - 1];
    if (line === undefined) {
      throw AppError.internal('reserve script aralik disi kalem dondurdu', {
        details: { index, lines: command.lines.length },
      });
    }
    return line;
  }
}
