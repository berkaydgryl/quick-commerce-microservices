/**
 * Sonuclandirma script'lerinin istemcisi: lua/release.lua (birakma ve sure dolumu
 * kipleri; T10.2, T10.3, ADR-02) ve lua/commit.lua (T10.2; ADR-01, ADR-18).
 * Anahtarlar on okunan hash'ten (reservation-hash.ts) kurulur; kayit okuma ile
 * script arasinda degistiyse 'stale' doner, depo yeniden dener.
 */

import { AppError } from '@getir/core';
import type { LuaScript } from '@getir/redis-kit';
import {
  reservationIndexKey,
  reservationKey,
  stockAvailKey,
  userReservationKey,
} from '@getir/redis-kit';

import type {
  CommitCommand,
  CommitOutcome,
  ReleaseCommand,
  ReleaseOutcome,
} from '../../domain/reservation.js';
import { COMMIT_REASON } from '../../domain/stock-ledger.js';
import {
  commitReplySchema,
  linesOf,
  releaseReplySchema,
  settledOf,
} from './reservation-replies.js';
import type { ReservationHash } from './reservation-hash.js';

/** commit.lua ve release.lua'nin depo ayarlarindan ihtiyaci (RedisReservationStoreOptions'in parcasi). */
export interface SettleOptions {
  /** Sonuclanan kaydin izinin en uzun omru (ms; ADR-18). */
  readonly settledTtlMs: number;
}

/** release.lua'nin kipi: Release RPC ya da supurucu (yalnizca bitis ani gecmisse). */
type ReleaseMode = 'release' | 'expire';

/** release.lua'nin iki kipte ortak sonucu. */
type ReleaseScriptOutcome = ReleaseOutcome | { readonly status: 'not-due' };

export async function commitOnce(
  script: LuaScript,
  options: SettleOptions,
  command: CommitCommand,
  hash: ReservationHash | undefined,
): Promise<CommitOutcome | 'stale'> {
  const { orderId, marketId, nowMs } = command;
  const keys = [
    reservationKey(marketId, orderId),
    reservationIndexKey(marketId),
    ...(hash === undefined ? [] : [userReservationKey(hash.userId)]),
  ];
  const args = [orderId, hash?.userId ?? '', COMMIT_REASON, nowMs, options.settledTtlMs];

  const parsed = commitReplySchema.safeParse(await script.run(keys, args));
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

export async function releaseOnce(
  script: LuaScript,
  options: SettleOptions,
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
  const args = [orderId, hash?.userId ?? '', reason, nowMs, options.settledTtlMs, mode, ...skus];

  const parsed = releaseReplySchema.safeParse(await script.run(keys, args));
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
