/**
 * Sema ve veri gocleri (T10.4, ADR-19): tipler ve uygulanmis kayitlarla kodun
 * karsilastirilmasi. Saf: Mongo'ya dokunmaz (calistirici migration-runner.ts).
 *
 * Kurallar (proje kurallari "Veritabani"):
 *   - Goc sahibi servisin kodundadir (`apps/<servis>/src/migrations`, ADR-05)
 *     ve servisin KENDI veritabaninda kosar (D14).
 *   - Surum artan tam sayidir; uygulanmis goc DEGISTIRILMEZ, duzeltme yeni goctur.
 *   - Goc o gunun mantiginin donmus kopyasini tasir: domain kodu degisince eski
 *     goc degismesin diye domain'e baglanmaz.
 *   - Indeksler goc degildir; bildirimli kalir (`MongoRepository.indexes()`).
 */

import { AppError } from '@getir/core';
import type { Logger } from '@getir/core';
import type { ClientSession, Db } from 'mongodb';

/** Uygulanan goclerin kaydi; servisin kendi veritabaninda. */
export const MIGRATIONS_COLLECTION = 'migrations';
/** Es zamanli calismaya karsi tek belgelik kilit. */
export const MIGRATIONS_LOCK_COLLECTION = 'migrations_lock';

export interface MigrationContext {
  readonly db: Db;
  /** Transaction'li gocte oturum: her okuma ve yazima verilir. `transaction: false` ise yok. */
  readonly session: ClientSession | undefined;
  readonly logger: Logger;
}

export interface Migration {
  /** Artan tam sayi (1, 2, 3...): dosya adindaki sira numarasi. */
  readonly version: number;
  /** Kisa ad, dosya adindaki gibi: 'arama-terimlerini-katla'. */
  readonly name: string;
  /**
   * Varsayilan true: goc ve kaydi TEK transaction'da (ya ikisi ya hicbiri).
   * false: transaction'da yapilamayan is icin (koleksiyon dusurme...); goc
   * yarida kalabilecegi icin yeniden calistirilabilir yazilir.
   */
  readonly transaction?: boolean;
  up(context: MigrationContext): Promise<void>;
  down(context: MigrationContext): Promise<void>;
}

/** Uygulanmis goc. `_id` surumdur: ayni goc iki kez kaydedilemez. */
export interface MigrationRecord {
  _id: number;
  name: string;
  appliedAt: Date;
  durationMs: number;
}

export interface MigrationStatus {
  /** Uygulanmislar, surum sirasinda. */
  readonly applied: readonly MigrationRecord[];
  /** Kodda olup uygulanmamis olanlar, surum sirasinda. */
  readonly pending: readonly Pick<Migration, 'version' | 'name'>[];
  /** Calismayi durduran tutarsizliklar; bos degilse goc uygulanmaz. */
  readonly conflicts: readonly string[];
}

/**
 * Goc listesi gecerli mi: surumler pozitif tam sayi ve ARTAN sirada, adlar
 * dolu ve tekil. Liste kodda yazili oldugu icin hata programlama hatasidir.
 */
export function assertMigrationList(migrations: readonly Migration[]): void {
  const names = new Set<string>();
  let previous = 0;
  for (const { version, name } of migrations) {
    if (!Number.isSafeInteger(version) || version <= previous) {
      throw AppError.internal('goc listesi gecersiz: surumler artan pozitif tam sayi olmali', {
        details: { version, previous },
      });
    }
    if (name.trim() === '' || names.has(name)) {
      throw AppError.internal('goc listesi gecersiz: ad bos ya da tekrar ediyor', {
        details: { version, name },
      });
    }
    names.add(name);
    previous = version;
  }
}

/**
 * Kayitlarla kodu karsilastirir. Tutarsizlik (calisma durur):
 *   - kayitta olup kodda olmayan surum: kod geri alinmis, o gocu bilmiyor;
 *   - ayni surum farkli adla: goc dosyasi degistirilmis ya da numara cakismis;
 *   - en yeni uygulanmistan KUCUK bekleyen surum: sira bozuk (sonradan eklenmis eski numara).
 */
export function migrationStatus(
  records: readonly MigrationRecord[],
  migrations: readonly Migration[],
): MigrationStatus {
  const applied = [...records].sort((left, right) => left._id - right._id);
  const byVersion = new Map(migrations.map((migration) => [migration.version, migration]));
  const conflicts: string[] = [];
  for (const record of applied) {
    const migration = byVersion.get(record._id);
    if (migration === undefined) {
      conflicts.push(`surum ${record._id} (${record.name}) uygulanmis ama kodda yok`);
    } else if (migration.name !== record.name) {
      conflicts.push(`surum ${record._id} kayitta "${record.name}", kodda "${migration.name}"`);
    }
  }
  const appliedVersions = new Set(applied.map((record) => record._id));
  // Kodda olmayan surum zaten tutarsizlik; sira denetimi bilinen surumlere bakar.
  const latest = applied.filter((record) => byVersion.has(record._id)).at(-1)?._id ?? 0;
  const pending = migrations
    .filter((migration) => !appliedVersions.has(migration.version))
    .map(({ version, name }) => ({ version, name }));
  for (const { version, name } of pending) {
    if (version < latest) {
      conflicts.push(`surum ${version} (${name}) bekliyor ama daha yeni ${latest} uygulanmis`);
    }
  }
  return { applied, pending, conflicts };
}
