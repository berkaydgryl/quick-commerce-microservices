/**
 * Goc kilidi (T10.4, ADR-19): servisin iki ornegi ayni anda acilinca gocu
 * yalnizca biri uygular. Kilit servisin kendi veritabaninda TEK belgedir
 * (`migrations_lock`); calistirici yalnizca Mongo'ya baglidir (Redis
 * kullanmayan servis de goc calistirir).
 *
 * Alma, tek atomik islemdir: belge yoksa ya da omru dolmussa ya da zaten
 * bizdeyse yazilir (upsert). Baskasindaysa filtre tutmaz, upsert ayni `_id`
 * ile eklemeye kalkar ve benzersizlik ihlaliyle reddedilir: kilit dolu.
 *
 * Omur, coken calistirmanin kilidini birakir. Calisan sahip her goc oncesi
 * omru yeniler; yenileyemezse (kilit baskasina gecmis) durur.
 */

import { randomUUID } from 'node:crypto';

import { AppError, ERROR_CODES, systemClock } from '@getir/core';
import type { Clock, Logger } from '@getir/core';
import type { Collection, Db } from 'mongodb';

import { isDuplicateKeyError, toMongoAppError } from './errors.js';
import { MIGRATIONS_LOCK_COLLECTION } from './migration.js';

/** Kilidin omru: en uzun gocten belirgin uzun (transaction'li goc zaten 60 sn ile sinirli). */
export const DEFAULT_MIGRATION_LOCK_TTL_MS = 10 * 60 * 1000;
/** Dolu kilidin yeniden denenme araligi. */
export const DEFAULT_MIGRATION_LOCK_POLL_MS = 500;

const LOCK_ID = 'migrations';

interface LockDocument {
  _id: string;
  owner: string;
  acquiredAt: Date;
  expiresAt: Date;
}

export interface MigrationLockOptions {
  readonly ttlMs?: number;
  readonly pollMs?: number;
  /** Sahiplik belirteci; verilmezse surece ozgu rastgele. */
  readonly owner?: string;
  readonly clock?: Clock;
  readonly sleep?: (ms: number) => Promise<void>;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class MongoMigrationLock {
  private readonly collection: Collection<LockDocument>;
  private readonly ttlMs: number;
  private readonly pollMs: number;
  private readonly owner: string;
  private readonly clock: Clock;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    db: Db,
    private readonly logger: Logger,
    options: MigrationLockOptions = {},
  ) {
    this.collection = db.collection<LockDocument>(MIGRATIONS_LOCK_COLLECTION);
    this.ttlMs = options.ttlMs ?? DEFAULT_MIGRATION_LOCK_TTL_MS;
    this.pollMs = options.pollMs ?? DEFAULT_MIGRATION_LOCK_POLL_MS;
    this.owner = options.owner ?? randomUUID();
    this.clock = options.clock ?? systemClock;
    this.sleep = options.sleep ?? wait;
  }

  /**
   * Kilidi alana kadar bekler. En kotu durumda baskasinin kilidinin omru dolar
   * ve alinir; sahibi omru yenilemeye devam ederse (uzun goc) omur kadar
   * beklendikten sonra hata.
   */
  async acquire(): Promise<void> {
    const deadline = this.clock.now() + this.ttlMs + this.pollMs;
    let announced = false;
    while (!(await this.tryAcquire())) {
      if (!announced) {
        this.logger.info({}, 'goc kilidi baska ornekte; bitmesi bekleniyor');
        announced = true;
      }
      if (this.clock.now() >= deadline) {
        throw new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'goc kilidi alinamadi', {
          details: { waitedMs: this.ttlMs },
        });
      }
      await this.sleep(this.pollMs);
    }
  }

  /** Omru uzatir; kilit artik bizde degilse (omru dolup baskasina gecmis) hata. */
  async renew(): Promise<void> {
    const now = this.clock.now();
    const result = await this.run('renew', () =>
      this.collection.updateOne(
        { _id: LOCK_ID, owner: this.owner },
        { $set: { expiresAt: new Date(now + this.ttlMs) } },
      ),
    );
    if (result.matchedCount === 0) {
      throw AppError.internal('goc kilidi kaybedildi: omru dolup baska ornege gecmis');
    }
  }

  /** Yalnizca sahibi birakir; birakilamazsa omru dolunca duser. */
  async release(): Promise<void> {
    try {
      await this.run('release', () =>
        this.collection.deleteOne({ _id: LOCK_ID, owner: this.owner }),
      );
    } catch (error: unknown) {
      this.logger.warn({ err: error }, 'goc kilidi birakilamadi; omru dolunca duser');
    }
  }

  private async tryAcquire(): Promise<boolean> {
    const now = this.clock.now();
    try {
      await this.collection.updateOne(
        {
          _id: LOCK_ID,
          $or: [{ owner: this.owner }, { expiresAt: { $lte: new Date(now) } }],
        },
        {
          $set: {
            owner: this.owner,
            acquiredAt: new Date(now),
            expiresAt: new Date(now + this.ttlMs),
          },
        },
        { upsert: true },
      );
      return true;
    } catch (error: unknown) {
      if (isDuplicateKeyError(error)) {
        return false;
      }
      throw toMongoAppError(error, {
        operation: 'acquire',
        collection: MIGRATIONS_LOCK_COLLECTION,
      });
    }
  }

  private async run<T>(operation: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error: unknown) {
      throw toMongoAppError(error, { operation, collection: MIGRATIONS_LOCK_COLLECTION });
    }
  }
}
