/**
 * Goc calistiricisi (T10.4, ADR-19). Servis acilista bekleyen gocleri
 * uygular (`applyMigrations`); elle `pnpm migrate up|down|status`
 * (migration-command.ts).
 *
 * Akis (up):
 *   1. Kayitlar okunur ve kodla karsilastirilir; tutarsizlik varsa durur.
 *   2. Bekleyen yoksa biter: KILIT ALINMAZ (her acilista yazim olmasin).
 *   3. Kilit alinir (ikinci ornek burada bekler); kayitlar YENIDEN okunur:
 *      beklerken obur ornek hepsini uygulamis olabilir.
 *   4. Her bekleyen icin: kilidin omru yenilenir, goc uygulanir; varsayilan
 *      olarak goc ve kaydi tek transaction'dadir. Kayit `_id`'si surum oldugu
 *      icin kilit bir sebeple asilsa bile ayni goc iki kez kaydedilemez.
 *   5. Kilit birakilir.
 */

import { AppError, systemClock } from '@getir/core';
import type { Clock, Logger } from '@getir/core';
import type { ClientSession, Collection } from 'mongodb';

import type { MongoConnection } from './client.js';
import { toMongoAppError } from './errors.js';
import { MongoMigrationLock } from './migration-lock.js';
import type { MigrationLockOptions } from './migration-lock.js';
import { assertMigrationList, MIGRATIONS_COLLECTION, migrationStatus } from './migration.js';
import type { Migration, MigrationRecord, MigrationStatus } from './migration.js';

export interface MigrationRunnerOptions {
  readonly connection: MongoConnection;
  /** Servisin gocleri, surum sirasinda (src/migrations/index.ts). */
  readonly migrations: readonly Migration[];
  readonly logger: Logger;
  readonly clock?: Clock;
  readonly lock?: Omit<MigrationLockOptions, 'clock'>;
}

export interface MigrationRunner {
  /** Bekleyenleri surum sirasinda uygular; uygulananlarin kayitlarini dondurur. */
  up(): Promise<readonly MigrationRecord[]>;
  /** En son uygulanan TEK gocu geri alir; uygulanmis goc yoksa undefined. */
  down(): Promise<MigrationRecord | undefined>;
  /** Kilitsiz okuma: uygulanmis, bekleyen ve tutarsizliklar. */
  status(): Promise<MigrationStatus>;
}

export function createMigrationRunner(options: MigrationRunnerOptions): MigrationRunner {
  assertMigrationList(options.migrations);
  const { connection, migrations } = options;
  const clock = options.clock ?? systemClock;
  const logger = options.logger.child({ component: 'migrations' });
  const records: Collection<MigrationRecord> =
    connection.db.collection<MigrationRecord>(MIGRATIONS_COLLECTION);
  const lock = new MongoMigrationLock(connection.db, logger, { ...options.lock, clock });

  const readStatus = async (): Promise<MigrationStatus> => {
    try {
      return migrationStatus(await records.find({}).toArray(), migrations);
    } catch (error: unknown) {
      throw toMongoAppError(error, { operation: 'find', collection: MIGRATIONS_COLLECTION });
    }
  };

  const assertConsistent = (status: MigrationStatus): void => {
    if (status.conflicts.length > 0) {
      throw AppError.internal('gocler kodla tutarsiz; uygulanmadi', {
        details: { conflicts: status.conflicts.join(' | ') },
      });
    }
  };

  /** Goc ve kaydi: varsayilan tek transaction, `transaction: false` ise sirayla. */
  const inTransaction = async <T>(
    migration: Migration,
    work: (session: ClientSession | undefined) => Promise<T>,
  ): Promise<T> => {
    if (migration.transaction === false) {
      try {
        return await work(undefined);
      } catch (error: unknown) {
        throw toMongoAppError(error, { operation: 'migration', collection: MIGRATIONS_COLLECTION });
      }
    }
    return connection.withTransaction((session) => work(session));
  };

  const applyUp = (migration: Migration): Promise<MigrationRecord> =>
    inTransaction(migration, async (session) => {
      const startedAt = clock.now();
      await migration.up({ db: connection.db, session, logger });
      const record: MigrationRecord = {
        _id: migration.version,
        name: migration.name,
        appliedAt: new Date(clock.now()),
        durationMs: clock.now() - startedAt,
      };
      await records.insertOne(record, session === undefined ? {} : { session });
      return record;
    });

  const applyDown = (migration: Migration, record: MigrationRecord): Promise<MigrationRecord> =>
    inTransaction(migration, async (session) => {
      await migration.down({ db: connection.db, session, logger });
      await records.deleteOne({ _id: record._id }, session === undefined ? {} : { session });
      return record;
    });

  const withLock = async <T>(work: () => Promise<T>): Promise<T> => {
    await lock.acquire();
    try {
      return await work();
    } finally {
      await lock.release();
    }
  };

  return {
    up: async () => {
      const before = await readStatus();
      assertConsistent(before);
      if (before.pending.length === 0) {
        logger.info({ applied: before.applied.length }, 'gocler guncel');
        return [];
      }
      return withLock(async () => {
        const current = await readStatus();
        assertConsistent(current);
        const applied: MigrationRecord[] = [];
        for (const { version } of current.pending) {
          const migration = migrations.find((candidate) => candidate.version === version);
          if (migration === undefined) {
            continue;
          }
          await lock.renew();
          const record = await applyUp(migration);
          logger.info(
            { version: record._id, name: record.name, durationMs: record.durationMs },
            'goc uygulandi',
          );
          applied.push(record);
        }
        if (applied.length === 0) {
          logger.info({ applied: current.applied.length }, 'gocleri baska ornek uyguladi');
        }
        return applied;
      });
    },

    down: () =>
      withLock(async () => {
        const current = await readStatus();
        const last = current.applied.at(-1);
        if (last === undefined) {
          return undefined;
        }
        const migration = migrations.find((candidate) => candidate.version === last._id);
        if (migration === undefined || migration.name !== last.name) {
          throw AppError.internal('son uygulanan goc kodda yok; geri alinamaz', {
            details: { version: last._id, name: last.name },
          });
        }
        await lock.renew();
        const record = await applyDown(migration, last);
        logger.info({ version: record._id, name: record.name }, 'goc geri alindi');
        return record;
      }),

    status: readStatus,
  };
}

/**
 * Servis acilisinda: bekleyen gocleri uygular (indekslerden ONCE). Tutarsizlik
 * ya da hata acilisi durdurur: kod, uygulanmamis semayla calismamali.
 */
export async function applyMigrations(
  connection: MongoConnection,
  migrations: readonly Migration[],
  logger: Logger,
): Promise<void> {
  await createMigrationRunner({ connection, migrations, logger }).up();
}
