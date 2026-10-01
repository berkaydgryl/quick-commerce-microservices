/**
 * Goc calistiricisi gercek Mongo'da (T10.4, ADR-19; roadmap bitti tanimi:
 * "up -> down -> up ayni semayi verir; iki ornek ayni anda baslatilinca goc
 * bir kez kosar; Testcontainers ile testli").
 */

import { AppError, ERROR_CODES, silentLogger } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { connectMongo } from '../../src/client.js';
import type { MongoConnection } from '../../src/client.js';
import { createMigrationRunner } from '../../src/migration-runner.js';
import type { MigrationRunnerOptions } from '../../src/migration-runner.js';
import { MIGRATIONS_COLLECTION, MIGRATIONS_LOCK_COLLECTION } from '../../src/migration.js';
import type { Migration, MigrationContext } from '../../src/migration.js';

/** infra/docker/docker-compose.dev.yml ile ayni surum. */
const MONGO_IMAGE = 'mongo:7';
const DB_NAME = 'getir_migration_test';

interface Item {
  _id: string;
  label: string;
}
interface Counter {
  _id: string;
  runs: number;
}

let container: StartedMongoDBContainer;
let connection: MongoConnection;

const items = (db = connection.db) => db.collection<Item>('items');
const sessionOf = ({ session }: MigrationContext) => (session === undefined ? {} : { session });

/** 1: iki belge ekler; geri alinca siler. */
const seedItems: Migration = {
  version: 1,
  name: 'ornek-belgeler',
  up: async (context) => {
    await items(context.db).insertMany(
      [
        { _id: 'a', label: 'Elma' },
        { _id: 'b', label: 'Armut' },
      ],
      sessionOf(context),
    );
  },
  down: async (context) => {
    await items(context.db).deleteMany({ _id: { $in: ['a', 'b'] } }, sessionOf(context));
  },
};

/** 2: etiketleri kucuk harfe cevirir; geri alinca ilk harfi buyutur (veri gocu). */
const lowercase: Migration = {
  version: 2,
  name: 'etiket-kucuk-harf',
  up: async (context) => {
    for (const item of await items(context.db).find({}, sessionOf(context)).toArray()) {
      await items(context.db).updateOne(
        { _id: item._id },
        { $set: { label: item.label.toLowerCase() } },
        sessionOf(context),
      );
    }
  },
  down: async (context) => {
    for (const item of await items(context.db).find({}, sessionOf(context)).toArray()) {
      const label = item.label.charAt(0).toUpperCase() + item.label.slice(1);
      await items(context.db).updateOne({ _id: item._id }, { $set: { label } }, sessionOf(context));
    }
  },
};

const runner = (migrations: readonly Migration[], extra: Partial<MigrationRunnerOptions> = {}) =>
  createMigrationRunner({ connection, migrations, logger: silentLogger, ...extra });

async function snapshot(): Promise<Item[]> {
  return items()
    .find({}, { sort: { _id: 1 } })
    .toArray();
}

beforeAll(async () => {
  container = await new MongoDBContainer(MONGO_IMAGE).start();
  connection = await connectMongo({
    uri: `${container.getConnectionString()}/?directConnection=true`,
    dbName: DB_NAME,
    appName: 'mongo-kit-goc-testi',
  });
});

beforeEach(async () => {
  await connection.db.dropDatabase();
});

afterAll(async () => {
  await connection?.close();
  await container?.stop();
});

describe('goc calistiricisi (T10.4)', () => {
  it('bekleyenleri surum sirasinda uygular ve kaydeder; ikinci up hicbir sey yapmaz, kilide dokunmaz', async () => {
    const applied = await runner([seedItems, lowercase]).up();

    expect(applied.map((r) => [r._id, r.name])).toEqual([
      [1, 'ornek-belgeler'],
      [2, 'etiket-kucuk-harf'],
    ]);
    expect(await snapshot()).toEqual([
      { _id: 'a', label: 'elma' },
      { _id: 'b', label: 'armut' },
    ]);
    expect(await runner([seedItems, lowercase]).up()).toEqual([]);
    expect(await connection.db.collection(MIGRATIONS_COLLECTION).countDocuments()).toBe(2);
    // Kilit birakildi; guncel durumda hic alinmadi.
    expect(await connection.db.collection(MIGRATIONS_LOCK_COLLECTION).countDocuments()).toBe(0);
  });

  it('bitti tanimi: up -> down -> up ayni veriyi verir; down yalnizca son gocu geri alir', async () => {
    const migrations = [seedItems, lowercase];
    await runner(migrations).up();
    const first = await snapshot();

    expect((await runner(migrations).down())?._id).toBe(2);
    expect(await snapshot()).toEqual([
      { _id: 'a', label: 'Elma' },
      { _id: 'b', label: 'Armut' },
    ]);
    expect((await runner(migrations).status()).pending).toEqual([
      { version: 2, name: 'etiket-kucuk-harf' },
    ]);

    await runner(migrations).up();
    expect(await snapshot()).toEqual(first);
  });

  it('transaction: goc yarida duserse ne verisi ne kaydi kalir; duzeltilince yeniden uygulanir', async () => {
    await runner([seedItems]).up();
    let fail = true;
    const halfway: Migration = {
      version: 2,
      name: 'yarida-kalan',
      up: async (context) => {
        await items(context.db).updateOne(
          { _id: 'a' },
          { $set: { label: 'DEGISTI' } },
          sessionOf(context),
        );
        if (fail) {
          throw AppError.internal('goc yarida dustu');
        }
      },
      down: () => Promise.resolve(),
    };

    await expect(runner([seedItems, halfway]).up()).rejects.toMatchObject({
      message: 'goc yarida dustu',
    });
    expect((await snapshot())[0]?.label).toBe('Elma');
    expect((await runner([seedItems, halfway]).status()).pending).toHaveLength(1);
    expect(await connection.db.collection(MIGRATIONS_LOCK_COLLECTION).countDocuments()).toBe(0);

    fail = false;
    await runner([seedItems, halfway]).up();
    expect((await snapshot())[0]?.label).toBe('DEGISTI');
  });

  it('transaction: false goc oturumsuz kosar (transaction disi is); kaydi sonra yazilir', async () => {
    let sawSession: boolean | undefined;
    const outside: Migration = {
      version: 1,
      name: 'transaction-disi',
      transaction: false,
      up: async (context) => {
        sawSession = context.session !== undefined;
        await context.db.createCollection('ayri_koleksiyon');
      },
      down: async (context) => {
        await context.db.dropCollection('ayri_koleksiyon');
      },
    };

    await runner([outside]).up();
    expect(sawSession).toBe(false);
    expect(
      (await connection.db.listCollections({ name: 'ayri_koleksiyon' }).toArray()).length,
    ).toBe(1);
    await runner([outside]).down();
    expect(
      (await connection.db.listCollections({ name: 'ayri_koleksiyon' }).toArray()).length,
    ).toBe(0);
  });

  it('bitti tanimi: iki ornek ayni anda baslayinca goc BIR kez kosar; ikincisi bekler ve uygulanmis bulur', async () => {
    const counters = connection.db.collection<Counter>('counters');
    const slow: Migration = {
      version: 1,
      name: 'yavas-goc',
      up: async (context) => {
        await counters.updateOne(
          { _id: 'yavas-goc' },
          { $inc: { runs: 1 } },
          { upsert: true, ...sessionOf(context) },
        );
        await new Promise((resolve) => setTimeout(resolve, 300));
      },
      down: () => Promise.resolve(),
    };
    const lines: LogLine[] = [];
    const lock = { pollMs: 20 };

    const results = await Promise.all([
      runner([slow], { lock: { ...lock, owner: 'ornek-a' }, logger: recordingLogger(lines) }).up(),
      runner([slow], { lock: { ...lock, owner: 'ornek-b' }, logger: recordingLogger(lines) }).up(),
    ]);

    expect(results.map((applied) => applied.length).sort()).toEqual([0, 1]);
    expect(await counters.findOne({ _id: 'yavas-goc' })).toEqual({ _id: 'yavas-goc', runs: 1 });
    expect(lines.map((l) => l.message)).toContain('goc kilidi baska ornekte; bitmesi bekleniyor');
    expect(lines.map((l) => l.message)).toContain('gocleri baska ornek uyguladi');
  });

  it('coken ornegin omru dolmus kilidi devralinir; dolu kilit omru dolana kadar beklenir', async () => {
    const lockCollection = connection.db.collection<{
      _id: string;
      owner: string;
      acquiredAt: Date;
      expiresAt: Date;
    }>(MIGRATIONS_LOCK_COLLECTION);
    await lockCollection.insertOne({
      _id: 'migrations',
      owner: 'coken-ornek',
      acquiredAt: new Date(Date.now() - 120_000),
      expiresAt: new Date(Date.now() - 60_000),
    });
    expect(await runner([seedItems]).up()).toHaveLength(1);

    await lockCollection.insertOne({
      _id: 'migrations',
      owner: 'calisan-ornek',
      acquiredAt: new Date(),
      expiresAt: new Date(Date.now() + 400),
    });
    const started = Date.now();
    expect(await runner([seedItems, lowercase], { lock: { pollMs: 20 } }).up()).toHaveLength(1);
    expect(Date.now() - started).toBeGreaterThanOrEqual(350);
  });

  it('kayitta olup kodda olmayan surum varsa (kod geri alinmis) hicbir goc uygulanmaz', async () => {
    await runner([seedItems, lowercase]).up();
    await connection.db.dropCollection('items');

    const failure = runner([seedItems]).up();

    await expect(failure).rejects.toBeInstanceOf(AppError);
    await expect(failure).rejects.toMatchObject({
      code: ERROR_CODES.INTERNAL,
      message: 'gocler kodla tutarsiz; uygulanmadi',
    });
    expect(await snapshot()).toEqual([]);
  });

  it('kilit gocler arasinda baska ornege gecmisse sonraki goc uygulanmaz', async () => {
    const stealLock: Migration = {
      version: 1,
      name: 'kilidi-kaptiran',
      // Omru dolup baskasinin aldigi kilidin taklidi (transaction'la birlikte yazilir).
      up: async (context) => {
        await context.db
          .collection<{ _id: string; owner: string }>(MIGRATIONS_LOCK_COLLECTION)
          .updateOne({ _id: 'migrations' }, { $set: { owner: 'baska-ornek' } }, sessionOf(context));
      },
      down: () => Promise.resolve(),
    };

    await expect(runner([stealLock, { ...lowercase, version: 2 }]).up()).rejects.toMatchObject({
      message: 'goc kilidi kaybedildi: omru dolup baska ornege gecmis',
    });
    expect((await runner([stealLock, lowercase]).status()).applied.map((r) => r._id)).toEqual([1]);
    // Birakma yalnizca sahibinin: kilidi kaybeden ornek baskasinin kilidini silmez.
    expect(await connection.db.collection(MIGRATIONS_LOCK_COLLECTION).findOne({})).toMatchObject({
      owner: 'baska-ornek',
    });
  });
});
