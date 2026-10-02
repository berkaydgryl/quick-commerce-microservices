import { AppError } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { MIGRATE_EXIT, migrateMain, runMigrationCommand } from '../../src/migration-command.js';
import type { MigrationRunner } from '../../src/migration-runner.js';
import type { MigrationStatus } from '../../src/migration.js';

const AT = new Date(Date.UTC(2026, 9, 1, 12));
const CLEAN: MigrationStatus = { applied: [], pending: [], conflicts: [] };

function setup(runner: Partial<MigrationRunner> = {}) {
  const lines: LogLine[] = [];
  const up = vi.fn(() => Promise.resolve([{ _id: 1, name: 'bir', appliedAt: AT, durationMs: 3 }]));
  const full: MigrationRunner = {
    up,
    down: () => Promise.resolve(undefined),
    status: () => Promise.resolve(CLEAN),
    ...runner,
  };
  return { runner: full, up, lines, logger: recordingLogger(lines) };
}

describe('runMigrationCommand (T10.4)', () => {
  it('up: uygulananlari yazar, cikis 0', async () => {
    const { runner, lines, logger } = setup();

    expect(await runMigrationCommand('up', runner, logger)).toBe(MIGRATE_EXIT.OK);
    expect(lines.at(-1)).toMatchObject({ message: 'goc up bitti', fields: { applied: ['1 bir'] } });
  });

  it('down: geri alinacak goc yoksa da cikis 0 ve bunu soyler', async () => {
    const { runner, lines, logger } = setup();

    expect(await runMigrationCommand('down', runner, logger)).toBe(MIGRATE_EXIT.OK);
    expect(lines.at(-1)?.message).toBe('geri alinacak goc yok');
  });

  it('status: tutarsizlik varsa cikis 1 (betikler durumu cikis koduyla okur)', async () => {
    const { runner, logger } = setup({
      status: () => Promise.resolve({ ...CLEAN, conflicts: ['surum 9 uygulanmis ama kodda yok'] }),
    });

    expect(await runMigrationCommand('status', runner, logger)).toBe(MIGRATE_EXIT.FAILED);
  });

  it('calistirici hata verirse firlatmaz: hata gunluge, cikis 1', async () => {
    const { runner, lines, logger } = setup({
      up: () => Promise.reject(AppError.internal('gocler kodla tutarsiz; uygulanmadi')),
    });

    expect(await runMigrationCommand('up', runner, logger)).toBe(MIGRATE_EXIT.FAILED);
    expect(lines.at(-1)).toMatchObject({ level: 'error', message: 'goc komutu basarisiz' });
  });

  it.each([undefined, 'yukari', 'DOWN'])(
    'bilinmeyen komut (%s): cikis 2, calistirici cagrilmaz',
    async (command) => {
      const { runner, up, lines, logger } = setup();

      expect(await runMigrationCommand(command, runner, logger)).toBe(MIGRATE_EXIT.USAGE);
      expect(up).not.toHaveBeenCalled();
      expect(lines.at(-1)?.message).toBe('bilinmeyen goc komutu');
    },
  );
});

describe('migrateMain (T10.4)', () => {
  it("bilinmeyen komutta Mongo'ya hic baglanmaz", async () => {
    const lines: LogLine[] = [];
    const exit = await migrateMain({
      command: 'yukari',
      // Ulasilamayan adres: baglanmaya kalkarsa test zaman asimiyla duser.
      mongo: {
        uri: 'mongodb://127.0.0.1:1/?directConnection=true',
        dbName: 'x',
        serverSelectionTimeoutMs: 60_000,
        operationTimeoutMs: 2_000,
      },
      migrations: [],
      appName: 'test-migrate',
      logger: recordingLogger(lines),
    });

    expect(exit).toBe(MIGRATE_EXIT.USAGE);
  });
});
