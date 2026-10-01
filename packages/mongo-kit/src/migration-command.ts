/**
 * Goc komutu (T10.4): her servisin `src/migrate.ts`'i bunu cagirir.
 *
 *   pnpm --filter @getir/<servis> migrate up | down | status
 *   pnpm migrate up | status          (kokten butun servisler; down servis bazinda)
 *
 * Ciktisi yapilandirilmis gunluktur (JSON): komut da servis gibi gunluk yazar.
 */

import type { Logger } from '@getir/core';

import { connectMongo } from './client.js';
import type { MongoConnection } from './client.js';
import type { MongoEnv } from './env.js';
import { createMigrationRunner } from './migration-runner.js';
import type { MigrationRunner } from './migration-runner.js';
import type { Migration } from './migration.js';

/** Komutun cikis kodlari. */
export const MIGRATE_EXIT = {
  OK: 0,
  /** Goc ya da baglanti basarisiz, durum tutarsiz. */
  FAILED: 1,
  /** Bilinmeyen komut. */
  USAGE: 2,
} as const;

export const MIGRATE_COMMANDS = ['up', 'down', 'status'] as const;
export type MigrateCommand = (typeof MIGRATE_COMMANDS)[number];

function isMigrateCommand(value: string | undefined): value is MigrateCommand {
  return MIGRATE_COMMANDS.some((command) => command === value);
}

function usageError(command: string | undefined, logger: Logger): number {
  logger.error(
    { command: command ?? '', expected: MIGRATE_COMMANDS.join(' | ') },
    'bilinmeyen goc komutu',
  );
  return MIGRATE_EXIT.USAGE;
}

/** Komutu calistirir, sonucu gunluge yazar ve cikis kodunu dondurur. Hata firlatmaz. */
export async function runMigrationCommand(
  command: string | undefined,
  runner: MigrationRunner,
  logger: Logger,
): Promise<number> {
  if (!isMigrateCommand(command)) {
    return usageError(command, logger);
  }
  try {
    switch (command) {
      case 'up': {
        const applied = await runner.up();
        logger.info({ applied: applied.map(({ _id, name }) => `${_id} ${name}`) }, 'goc up bitti');
        return MIGRATE_EXIT.OK;
      }
      case 'down': {
        const reverted = await runner.down();
        logger.info(
          { reverted: reverted === undefined ? null : `${reverted._id} ${reverted.name}` },
          reverted === undefined ? 'geri alinacak goc yok' : 'goc down bitti',
        );
        return MIGRATE_EXIT.OK;
      }
      case 'status': {
        const status = await runner.status();
        logger.info(
          {
            applied: status.applied.map(
              ({ _id, name, appliedAt }) => `${_id} ${name} ${appliedAt.toISOString()}`,
            ),
            pending: status.pending.map(({ version, name }) => `${version} ${name}`),
            conflicts: status.conflicts,
          },
          'goc durumu',
        );
        return status.conflicts.length === 0 ? MIGRATE_EXIT.OK : MIGRATE_EXIT.FAILED;
      }
    }
  } catch (error: unknown) {
    logger.error({ err: error, command }, 'goc komutu basarisiz');
    return MIGRATE_EXIT.FAILED;
  }
}

export interface MigrateMainOptions {
  /** `process.argv[2]`. */
  readonly command: string | undefined;
  readonly mongo: MongoEnv;
  readonly migrations: readonly Migration[];
  /** Mongo gunluklerinde gorunen ad: `<servis>-migrate`. */
  readonly appName: string;
  readonly logger: Logger;
}

/** Servisin `migrate` giris noktasi: baglanir, komutu calistirir, baglantiyi kapatir. */
export async function migrateMain(options: MigrateMainOptions): Promise<number> {
  const { logger } = options;
  if (!isMigrateCommand(options.command)) {
    return usageError(options.command, logger);
  }
  let connection: MongoConnection;
  try {
    connection = await connectMongo({ ...options.mongo, appName: options.appName, logger });
  } catch (error: unknown) {
    logger.fatal({ err: error }, 'goc icin mongo baglantisi kurulamadi');
    return MIGRATE_EXIT.FAILED;
  }
  try {
    const runner = createMigrationRunner({ connection, migrations: options.migrations, logger });
    return await runMigrationCommand(options.command, runner, logger);
  } finally {
    await connection.close();
  }
}
