/**
 * Rezervasyonun Redis uygulamasi: lua/reserve.lua (T10.1), lua/release.lua ve
 * lua/commit.lua (T10.2; ADR-01, ADR-18), lua/extend.lua ve lua/shorten.lua
 * (T11.3, B21). Sure dolumu release.lua'nin "expire" kipidir (T10.3, ADR-02).
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
  ExpireCommand,
  ExpireOutcome,
  ExtendCommand,
  ExtendOutcome,
  InactiveReservation,
  ReleaseCommand,
  ReleaseOutcome,
  ReservationLine,
  ReservationStore,
  ReserveCommand,
  ReserveOutcome,
  SettledReservation,
  ShortenCommand,
  ShortenOutcome,
} from '../../domain/reservation.js';
import { COMMIT_REASON, EXPIRE_REASON } from '../../domain/stock-ledger.js';
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
  .tuple([
    z.literal('settled'),
    z.enum(['released', 'committed', 'expired']),
    z.string().min(1),
    integerReply,
  ])
  .rest(pairsReply);

const releaseReplySchema = z.union([
  z.tuple([z.literal('released'), integerReply.pipe(z.number().int().min(0))]).rest(quantityReply),
  settledReplySchema,
  z.tuple([z.literal('absent')]),
  z.tuple([z.literal('orphaned')]),
  z.tuple([z.literal('stale')]),
  z.tuple([z.literal('not-due')]),
  z.tuple([z.literal('corrupt'), lineIndex]),
]);

/** release.lua'nin kipi: Release RPC ya da supurucu (yalnizca bitis ani gecmisse). */
type ReleaseMode = 'release' | 'expire';

/** release.lua'nin iki kipte ortak sonucu. */
type ReleaseScriptOutcome = ReleaseOutcome | { readonly status: 'not-due' };

const commitReplySchema = z.union([
  z.tuple([z.literal('committed')]).rest(pairsReply),
  settledReplySchema,
  z.tuple([z.literal('absent')]),
  z.tuple([z.literal('orphaned')]),
  z.tuple([z.literal('stale')]),
]);

/** extend.lua ve shorten.lua'nin ortak "aktif degil" cevaplari ve eskimis on okuma. */
const inactiveReplies = [
  z.tuple([z.literal('settled')]),
  z.tuple([z.literal('absent')]),
  z.tuple([z.literal('orphaned')]),
  z.tuple([z.literal('due')]),
  z.tuple([z.literal('stale')]),
] as const;

const extendReplySchema = z.union([
  z.tuple([z.literal('extended'), integerReply, integerReply]).rest(pairsReply),
  z.tuple([z.literal('limit'), integerReply, integerReply]),
  ...inactiveReplies,
]);

const shortenReplySchema = z.union([
  z.tuple([z.literal('shortened'), integerReply]),
  z.tuple([z.literal('unchanged'), integerReply]),
  ...inactiveReplies,
]);

/** On okuma ile script arasinda kayit degisirse (on okuma eskidiyse) kac kez denenir. */
const SETTLE_ATTEMPTS = 2;

export interface RedisReservationScripts {
  readonly reserve: LuaScript;
  readonly release: LuaScript;
  readonly commit: LuaScript;
  readonly extend: LuaScript;
  readonly shorten: LuaScript;
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
    return this.withPreRead(command, async (hash) => {
      const outcome = await this.releaseOnce(command, hash, 'release');
      if (outcome === 'stale') {
        return outcome;
      }
      if (outcome.status === 'not-due') {
        throw AppError.internal('release script birakma kipinde not-due dondurdu', {
          details: { orderId: command.orderId, marketId: command.marketId },
        });
      }
      return outcome;
    });
  }

  expire(command: ExpireCommand): Promise<ExpireOutcome> {
    return this.withPreRead(command, async (hash) => {
      const outcome = await this.releaseOnce({ ...command, reason: EXPIRE_REASON }, hash, 'expire');
      if (outcome === 'stale' || outcome.status !== 'released') {
        return outcome;
      }
      return { status: 'expired', lines: outcome.lines, skippedCounters: outcome.skippedCounters };
    });
  }

  /** Bitis ani gelmis siparisler, en eskisi once (ZRANGEBYSCORE, ADR-02). */
  listDue(marketId: string, nowMs: number, limit: number): Promise<readonly string[]> {
    return this.redis.zrangebyscore(
      reservationIndexKey(marketId),
      '-inf',
      nowMs,
      'LIMIT',
      0,
      limit,
    );
  }

  commit(command: CommitCommand): Promise<CommitOutcome> {
    return this.withPreRead(command, (hash) => this.commitOnce(command, hash));
  }

  extend(command: ExtendCommand): Promise<ExtendOutcome> {
    return this.withPreRead(command, (hash) => this.extendOnce(command, hash));
  }

  shorten(command: ShortenCommand): Promise<ShortenOutcome> {
    return this.withPreRead(command, (hash) => this.shortenOnce(command, hash));
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

  private async extendOnce(
    command: ExtendCommand,
    hash: ReservationHash | undefined,
  ): Promise<ExtendOutcome | 'stale'> {
    const { orderId, marketId, nowMs, additionalMs, maxExtensions } = command;
    const args = [
      orderId,
      hash?.userId ?? '',
      nowMs,
      additionalMs,
      this.options.holdAfterExpiryMs,
      maxExtensions,
    ];

    const parsed = extendReplySchema.safeParse(
      await this.scripts.extend.run(this.timingKeys(command, hash), args),
    );
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
      case 'stale':
        return 'stale';
      default:
        return inactiveOf(reply[0]);
    }
  }

  private async shortenOnce(
    command: ShortenCommand,
    hash: ReservationHash | undefined,
  ): Promise<ShortenOutcome | 'stale'> {
    const { orderId, marketId, nowMs, maxRemainingMs } = command;
    const args = [
      orderId,
      hash?.userId ?? '',
      nowMs,
      maxRemainingMs,
      this.options.holdAfterExpiryMs,
    ];

    const parsed = shortenReplySchema.safeParse(
      await this.scripts.shorten.run(this.timingKeys(command, hash), args),
    );
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
  private timingKeys(command: CommitCommand, hash: ReservationHash | undefined): string[] {
    return [
      reservationKey(command.marketId, command.orderId),
      reservationIndexKey(command.marketId),
      ...(hash === undefined ? [] : [userReservationKey(hash.userId)]),
    ];
  }

  private async releaseOnce(
    command: ReleaseCommand,
    hash: ReservationHash | undefined,
    mode: ReleaseMode,
  ): Promise<ReleaseScriptOutcome | 'stale'> {
    const { orderId, marketId, reason, nowMs } = command;
    const skus = hash?.lines.map(({ sku }) => sku) ?? [];
    const keys = [
      reservationKey(marketId, orderId),
      reservationIndexKey(marketId),
      ...skus.map((sku) => stockAvailKey(marketId, sku)),
      ...(hash === undefined ? [] : [userReservationKey(hash.userId)]),
    ];
    const args = [
      orderId,
      hash?.userId ?? '',
      reason,
      nowMs,
      this.options.settledTtlMs,
      mode,
      ...skus,
    ];

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
      case 'not-due':
        return { status: 'not-due' };
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

/** Script'in "aktif degil" cevabi -> sonuc (yazilan bir sey yok). */
function inactiveOf(reason: InactiveReservation['reason']): InactiveReservation {
  return { status: 'inactive', reason };
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
