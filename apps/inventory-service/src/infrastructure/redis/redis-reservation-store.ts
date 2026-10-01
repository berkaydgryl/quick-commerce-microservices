/**
 * Rezervasyonun Redis uygulamasi: lua/reserve.lua (T10.1), lua/release.lua ve
 * lua/commit.lua (T10.2; ADR-01, ADR-18).
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
import type { LuaScript, RedisConnection } from '@getir/redis-kit';
import {
  reservationIndexKey,
  reservationKey,
  stockAvailKey,
  userReservationKey,
} from '@getir/redis-kit';
import { z } from 'zod';

import { duplicateSku } from '../../domain/reservation.js';
import type {
  CommitCommand,
  CommitOutcome,
  ReleaseCommand,
  ReleaseOutcome,
  ReservationLine,
  ReservationStore,
  ReserveCommand,
  ReserveOutcome,
  SettledReservation,
} from '../../domain/reservation.js';
import { COMMIT_REASON } from '../../domain/stock-ledger.js';
import { readReservationHash } from './reservation-hash.js';
import type { ReservationHash } from './reservation-hash.js';

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

const reserveReplySchema = z.union([
  z.tuple([z.literal('reserved'), integerReply]),
  z.tuple([z.literal('already'), integerReply]),
  z.tuple([z.literal('user-active'), z.string().min(1)]),
  z.tuple([z.literal('insufficient'), lineIndex, integerReply]),
  z.tuple([z.literal('missing'), lineIndex]),
  z.tuple([z.literal('corrupt'), lineIndex]),
]);

const quantityReply = integerReply.pipe(z.number().int().min(1));

/** [sku, adet, sku, adet, ...] ciftleri (sira script'e gore). */
const pairsReply = z.union([z.string().min(1), z.number()]);

/** Daha once sonuclanmis kaydin izi: durum, gerekce, an, sonra ciftler. */
const settledReplySchema = z
  .tuple([z.literal('settled'), z.enum(['released', 'committed']), z.string().min(1), integerReply])
  .rest(pairsReply);

const releaseReplySchema = z.union([
  z.tuple([z.literal('released'), integerReply.pipe(z.number().int().min(0))]).rest(quantityReply),
  settledReplySchema,
  z.tuple([z.literal('absent')]),
  z.tuple([z.literal('orphaned')]),
  z.tuple([z.literal('stale')]),
  z.tuple([z.literal('corrupt'), lineIndex]),
]);

const commitReplySchema = z.union([
  z.tuple([z.literal('committed')]).rest(pairsReply),
  settledReplySchema,
  z.tuple([z.literal('absent')]),
  z.tuple([z.literal('orphaned')]),
  z.tuple([z.literal('stale')]),
]);

/** On okuma ile script arasinda kayit degisirse (on okuma eskidiyse) kac kez denenir. */
const SETTLE_ATTEMPTS = 2;

export interface RedisReservationScripts {
  readonly reserve: LuaScript;
  readonly release: LuaScript;
  readonly commit: LuaScript;
}

export interface RedisReservationStoreOptions {
  /** Hash'in bitisten sonra kalma payi (ms): supurucu gecikmeli tick'te okuyabilsin. */
  readonly holdAfterExpiryMs: number;
  /** Sonuclanan kaydin izinin en uzun omru (ms; ADR-18). */
  readonly settledTtlMs: number;
}

export class RedisReservationStore implements ReservationStore {
  constructor(
    private readonly redis: RedisConnection['redis'],
    private readonly scripts: RedisReservationScripts,
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

    const parsed = reserveReplySchema.safeParse(await this.scripts.reserve.run(keys, args));
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

  release(command: ReleaseCommand): Promise<ReleaseOutcome> {
    return this.withPreRead(command, (hash) => this.releaseOnce(command, hash));
  }

  commit(command: CommitCommand): Promise<CommitOutcome> {
    return this.withPreRead(command, (hash) => this.commitOnce(command, hash));
  }

  /**
   * Izi siler. Guvenli: iz dururken reserve.lua ayni siparisi yeniden acmaz
   * (EXISTS), dolayisiyla bu anahtar ancak sonuclanmis kaydi tasiyabilir.
   */
  async forgetSettled(marketId: string, orderId: string): Promise<void> {
    await this.redis.del(reservationKey(marketId, orderId));
  }

  /**
   * Once hash okunur: script'in dokunacagi sayaclar ve kullanici kilidi
   * KEYS'te bildirilmelidir. Okuma ile script arasinda kayit degistiyse
   * ('stale') bir kez daha okunup denenir; yine degistiyse CONFLICT.
   */
  private async withPreRead<T>(
    command: CommitCommand,
    attempt: (hash: ReservationHash | undefined) => Promise<T | 'stale'>,
  ): Promise<T> {
    for (let tries = 1; tries <= SETTLE_ATTEMPTS; tries += 1) {
      const hash = readReservationHash(
        await this.redis.hgetall(reservationKey(command.marketId, command.orderId)),
        command,
      );
      const outcome = await attempt(hash);
      if (outcome !== 'stale') {
        return outcome;
      }
    }
    throw AppError.conflict('Rezervasyon ayni anda degisti, tekrar deneyin', {
      details: { orderId: command.orderId, marketId: command.marketId },
    });
  }

  private async commitOnce(
    command: CommitCommand,
    hash: ReservationHash | undefined,
  ): Promise<CommitOutcome | 'stale'> {
    const { orderId, marketId, nowMs } = command;
    const keys = [
      reservationKey(marketId, orderId),
      reservationIndexKey(marketId),
      ...(hash === undefined ? [] : [userReservationKey(hash.userId)]),
    ];
    const args = [orderId, hash?.userId ?? '', COMMIT_REASON, nowMs, this.options.settledTtlMs];

    const parsed = commitReplySchema.safeParse(await this.scripts.commit.run(keys, args));
    if (!parsed.success) {
      throw AppError.internal('commit script beklenmeyen cevap verdi', {
        cause: parsed.error,
        details: { orderId, marketId },
      });
    }

    const reply = parsed.data;
    switch (reply[0]) {
      case 'committed': {
        const [, ...pairs] = reply;
        return { status: 'committed', lines: linesOf(pairs, command) };
      }
      case 'settled':
        return settledOf(reply, command);
      case 'absent':
        return { status: 'absent' };
      case 'orphaned':
        return { status: 'orphaned' };
      case 'stale':
        return 'stale';
    }
  }

  private async releaseOnce(
    command: ReleaseCommand,
    hash: ReservationHash | undefined,
  ): Promise<ReleaseOutcome | 'stale'> {
    const { orderId, marketId, reason, nowMs } = command;
    const skus = hash?.lines.map(({ sku }) => sku) ?? [];
    const keys = [
      reservationKey(marketId, orderId),
      reservationIndexKey(marketId),
      ...skus.map((sku) => stockAvailKey(marketId, sku)),
      ...(hash === undefined ? [] : [userReservationKey(hash.userId)]),
    ];
    const args = [orderId, hash?.userId ?? '', reason, nowMs, this.options.settledTtlMs, ...skus];

    const parsed = releaseReplySchema.safeParse(await this.scripts.release.run(keys, args));
    if (!parsed.success) {
      throw AppError.internal('release script beklenmeyen cevap verdi', {
        cause: parsed.error,
        details: { orderId, marketId },
      });
    }

    const reply = parsed.data;
    switch (reply[0]) {
      case 'released': {
        const [, skippedCounters, ...quantities] = reply;
        const lines = skus.flatMap((sku, index) => {
          const quantity = quantities[index];
          return quantity === undefined ? [] : [{ sku, quantity }];
        });
        if (lines.length !== skus.length || quantities.length !== skus.length) {
          throw AppError.internal('release script adetleri eksik dondurdu', {
            details: { orderId, marketId, expected: skus.length, received: quantities.length },
          });
        }
        return { status: 'released', skippedCounters, lines };
      }
      case 'settled':
        return settledOf(reply, command);
      case 'absent':
        return { status: 'absent' };
      case 'orphaned':
        return { status: 'orphaned' };
      case 'stale':
        return 'stale';
      case 'corrupt':
        throw AppError.internal('stok sayaci bozuk', {
          details: { marketId, sku: skus[reply[1] - 1] ?? `#${reply[1]}` },
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

/** 'settled' cevabi -> iz. */
function settledOf(
  reply: z.infer<typeof settledReplySchema>,
  command: CommitCommand,
): SettledReservation {
  const [, settlement, reason, settledAt, ...pairs] = reply;
  return { status: 'settled', settlement, reason, settledAt, lines: linesOf(pairs, command) };
}

/** Cevaptaki [sku, adet, sku, adet, ...] -> kalemler (sku sirasinda). */
function linesOf(pairs: readonly (string | number)[], command: CommitCommand): ReservationLine[] {
  const parsed = z
    .array(z.tuple([z.string().min(1), quantityReply]))
    .safeParse(
      Array.from({ length: Math.ceil(pairs.length / 2) }, (_, index) =>
        pairs.slice(index * 2, index * 2 + 2),
      ),
    );
  if (!parsed.success) {
    throw AppError.internal('script bozuk kalem listesi dondurdu', {
      cause: parsed.error,
      details: { orderId: command.orderId, marketId: command.marketId },
    });
  }
  return parsed.data
    .map(([sku, quantity]) => ({ sku, quantity }))
    .sort((left, right) => left.sku.localeCompare(right.sku));
}
