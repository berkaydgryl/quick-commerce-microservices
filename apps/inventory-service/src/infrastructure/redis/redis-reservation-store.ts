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
import { reservationIndexKey, reservationKey } from '@getir/redis-kit';

import type {
  CommitCommand,
  CommitOutcome,
  ExpireCommand,
  ExpireOutcome,
  ExtendCommand,
  ExtendOutcome,
  ReleaseCommand,
  ReleaseOutcome,
  ReservationStore,
  ReserveCommand,
  ReserveOutcome,
  ShortenCommand,
  ShortenOutcome,
} from '../../domain/reservation.js';
import { EXPIRE_REASON } from '../../domain/stock-ledger.js';
import { readReservationHash } from './reservation-hash.js';
import type { ReservationHash } from './reservation-hash.js';
import { runReserve } from './reservation-reserve.js';
import { commitOnce, releaseOnce } from './reservation-settle.js';
import { extendOnce, shortenOnce } from './reservation-timing.js';

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

  reserve(command: ReserveCommand): Promise<ReserveOutcome> {
    return runReserve(this.scripts.reserve, this.options, command);
  }

  release(command: ReleaseCommand): Promise<ReleaseOutcome> {
    return this.withPreRead(command, async (hash) => {
      const outcome = await releaseOnce(
        this.scripts.release,
        this.options,
        command,
        hash,
        'release',
      );
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
      const outcome = await releaseOnce(
        this.scripts.release,
        this.options,
        { ...command, reason: EXPIRE_REASON },
        hash,
        'expire',
      );
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
    return this.withPreRead(command, (hash) =>
      commitOnce(this.scripts.commit, this.options, command, hash),
    );
  }

  extend(command: ExtendCommand): Promise<ExtendOutcome> {
    return this.withPreRead(command, (hash) =>
      extendOnce(this.scripts.extend, this.options, command, hash),
    );
  }

  shorten(command: ShortenCommand): Promise<ShortenOutcome> {
    return this.withPreRead(command, (hash) =>
      shortenOnce(this.scripts.shorten, this.options, command, hash),
    );
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
}
