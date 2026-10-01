import { AppError } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { assertMigrationList, migrationStatus } from '../../src/migration.js';
import type { Migration, MigrationRecord } from '../../src/migration.js';

const noop = () => Promise.resolve();
const migration = (version: number, name: string): Migration => ({
  version,
  name,
  up: noop,
  down: noop,
});
const record = (version: number, name: string): MigrationRecord => ({
  _id: version,
  name,
  appliedAt: new Date(Date.UTC(2026, 9, 1)),
  durationMs: 5,
});

describe('assertMigrationList (T10.4)', () => {
  it('artan surumler ve tekil adlar gecerli; bos liste de', () => {
    expect(() => assertMigrationList([])).not.toThrow();
    expect(() =>
      assertMigrationList([migration(1, 'a'), migration(2, 'b'), migration(5, 'c')]),
    ).not.toThrow();
  });

  it.each([
    ['sifir surum', [migration(0, 'a')]],
    ['tam sayi olmayan surum', [migration(1.5, 'a')]],
    ['azalan surum', [migration(2, 'a'), migration(1, 'b')]],
    ['tekrar eden surum', [migration(1, 'a'), migration(1, 'b')]],
    ['tekrar eden ad', [migration(1, 'a'), migration(2, 'a')]],
    ['bos ad', [migration(1, ' ')]],
  ])('%s programlama hatasidir (INTERNAL)', (_, list) => {
    expect(() => assertMigrationList(list)).toThrow(AppError);
  });
});

describe('migrationStatus (T10.4)', () => {
  const code = [migration(1, 'bir'), migration(2, 'iki'), migration(3, 'uc')];

  it('uygulanmislar surum sirasinda, bekleyenler kodun sirasinda; tutarsizlik yok', () => {
    const status = migrationStatus([record(2, 'iki'), record(1, 'bir')], code);

    expect(status.applied.map((r) => r._id)).toEqual([1, 2]);
    expect(status.pending).toEqual([{ version: 3, name: 'uc' }]);
    expect(status.conflicts).toEqual([]);
  });

  it('kayitta olup kodda olmayan surum (kod geri alinmis) tutarsizliktir', () => {
    const status = migrationStatus([record(1, 'bir'), record(9, 'gelecek')], code);

    expect(status.conflicts).toEqual(['surum 9 (gelecek) uygulanmis ama kodda yok']);
  });

  it('ayni surum farkli adla (dosya degistirilmis ya da numara cakismis) tutarsizliktir', () => {
    const status = migrationStatus([record(1, 'baska')], code);

    expect(status.conflicts).toEqual(['surum 1 kayitta "baska", kodda "bir"']);
  });

  it('en yeni uygulanmistan kucuk bekleyen surum (sira bozuk) tutarsizliktir', () => {
    const status = migrationStatus([record(1, 'bir'), record(3, 'uc')], code);

    expect(status.pending).toEqual([{ version: 2, name: 'iki' }]);
    expect(status.conflicts).toEqual(['surum 2 (iki) bekliyor ama daha yeni 3 uygulanmis']);
  });
});
