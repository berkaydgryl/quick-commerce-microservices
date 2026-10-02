/**
 * Islem suresi (#51): Mongo cevap vermeden donarsa cagri asili kalmaz.
 *
 * Mongo'nun onunde dondurulabilen bir TCP vekili var (test/support/freezing-proxy.ts):
 * donukken baglanti acik kalir ama cevap gelmez, `docker pause` gibi. Sureli baglanti
 * (`operationTimeoutMs`) bu vekilden gecer; dogrulama ve temizlik vekili atlayan ayri
 * bir istemciyle yapilir.
 *
 * Kontrol deneyi: ayni vekilden gecen SURESIZ baglanti donukken cevap alamaz
 * (#51 oncesi davranis); sureli olan surede SERVICE_UNAVAILABLE doner.
 */

import { performance } from 'node:perf_hooks';

import { AppError, ERROR_CODES, silentLogger } from '@getir/core';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { MongoClient } from 'mongodb';
import type { Db, IndexDescription } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo } from '../../src/client.js';
import type { MongoConnection } from '../../src/client.js';
import { createMigrationRunner } from '../../src/migration-runner.js';
import type { Migration } from '../../src/migration.js';
import { MongoRepository } from '../../src/repository.js';
import type { BaseDocument, SessionOption } from '../../src/repository.js';
import { startFreezingProxy } from '../support/freezing-proxy.js';
import type { FreezingProxy } from '../support/freezing-proxy.js';

/** infra/docker/docker-compose.dev.yml ile ayni surum. */
const MONGO_IMAGE = 'mongo:7';
const DB_NAME = 'getir_timeout_test';
const COLLECTION = 'test_items';

/** Testin islem suresi: kisa tutulur, olcum payi genis. */
const OPERATION_TIMEOUT_MS = 500;
/** Yavas CI makinesi icin ust sinira eklenen pay. */
const SLACK_MS = 1_500;
/** "Hala bekliyor" denetimi: sureden belirgin uzun. */
const HANG_CHECK_MS = OPERATION_TIMEOUT_MS * 3;

interface ItemDoc extends BaseDocument {
  name: string;
  count: number;
}

class ItemRepository extends MongoRepository<ItemDoc> {
  constructor(db: Db) {
    super(db, COLLECTION);
  }

  protected override indexes(): readonly IndexDescription[] {
    return [{ key: { name: 1 }, unique: true, name: 'name_unique' }];
  }

  /** Servislerdeki toplu yazimin bicimi (outbox, stok defteri): bulkCollection ile. */
  async insertMany(documents: readonly ItemDoc[], options: SessionOption = {}): Promise<void> {
    await this.run('insertMany', () =>
      this.bulkCollection(options).insertMany(
        [...documents],
        options.session === undefined ? {} : { session: options.session },
      ),
    );
  }
}

let container: StartedMongoDBContainer;
let proxy: FreezingProxy;
/** Vekilden gecen, islem suresi OPERATION_TIMEOUT_MS. */
let bounded: MongoConnection;
let items: ItemRepository;
/** Vekili atlayan: dogrulama ve temizlik. */
let direct: MongoClient;

function directItems() {
  return direct.db(DB_NAME).collection<ItemDoc>(COLLECTION);
}

function proxyUri(): string {
  return `mongodb://127.0.0.1:${proxy.port}/?directConnection=true`;
}

interface Timed {
  readonly error: unknown;
  readonly ms: number;
}

/** Islemin hatasini ve ne kadar surdugunu dondurur; basarirsa testi dusurur. */
async function timedFailure(work: () => Promise<unknown>): Promise<Timed> {
  const started = performance.now();
  try {
    await work();
  } catch (error: unknown) {
    return { error, ms: performance.now() - started };
  }
  throw new Error('islem basarisiz olmaliydi');
}

/** Promise HANG_CHECK_MS icinde sonuclanmadi mi? */
async function stillPending(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await new Promise((resolve) => setTimeout(resolve, HANG_CHECK_MS));
  return !settled;
}

/**
 * Zaman asimi hatasi ve suresi: butceyi asmadi; `minMs` verilirse en az o kadar
 * bekledi (hemen dusmedi, gercekten surenin dolmasini bekledi).
 */
function expectTimeout(timed: Timed, budgetMs: number, minMs = OPERATION_TIMEOUT_MS - 50): void {
  expect(timed.error).toBeInstanceOf(AppError);
  expect(timed.error).toMatchObject({
    code: ERROR_CODES.SERVICE_UNAVAILABLE,
    message: 'Veritabani zamaninda cevap vermedi',
  });
  expect(timed.ms).toBeGreaterThanOrEqual(minMs);
  expect(timed.ms).toBeLessThan(budgetMs + SLACK_MS);
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

beforeAll(async () => {
  container = await new MongoDBContainer(MONGO_IMAGE).start();
  proxy = await startFreezingProxy({
    host: container.getHost(),
    port: container.getMappedPort(27017),
  });
  direct = await MongoClient.connect(`${container.getConnectionString()}/?directConnection=true`);
  bounded = await connectMongo({
    uri: proxyUri(),
    dbName: DB_NAME,
    appName: 'mongo-kit-timeout-test',
    operationTimeoutMs: OPERATION_TIMEOUT_MS,
  });
  items = new ItemRepository(bounded.db);
  await items.ensureIndexes();
});

afterEach(async () => {
  proxy.thaw();
  await directItems().deleteMany({});
  await direct.db(DB_NAME).collection('migrations').deleteMany({});
  // Donukken kapatilan baglantilarin yerine yenileri kurulsun; sonraki test temiz baslar.
  await expect(waitFor(() => bounded.ping())).resolves.toBe(true);
});

afterAll(async () => {
  proxy?.thaw();
  await bounded?.close();
  await direct?.close();
  await proxy?.close();
  await container?.stop();
});

describe('islem suresi (#51)', () => {
  it('kontrol: SURESIZ baglanti donmus Mongo da cevap alamaz (#51 oncesi davranis)', async () => {
    const unbounded = await connectMongo({ uri: proxyUri(), dbName: DB_NAME });
    try {
      const repo = new ItemRepository(unbounded.db);
      proxy.freeze();
      const lookup = repo.findById('itm_1');

      await expect(stillPending(lookup)).resolves.toBe(true);
      proxy.thaw();
      await expect(lookup).resolves.toBeNull();
    } finally {
      await unbounded.close();
    }
  });

  it('tekil islem donmus Mongo da islem suresinde SERVICE_UNAVAILABLE ile doner', async () => {
    proxy.freeze();

    expectTimeout(await timedFailure(() => items.findById('itm_1')), OPERATION_TIMEOUT_MS);
  });

  it('havuz tukenmez: donukken ard arda ve paralel islemlerin hepsi surede doner', async () => {
    proxy.freeze();
    // Ilk islem baglantisini kapatir; sonrakiler yeni baglanti kurmaya calisir (el sikisma da sureli).
    for (let call = 0; call < 3; call += 1) {
      expectTimeout(await timedFailure(() => items.count()), OPERATION_TIMEOUT_MS);
    }
    const started = performance.now();
    const parallel = await Promise.allSettled(
      Array.from({ length: 10 }, (_, index) => items.findById(`itm_${index}`)),
    );

    expect(parallel.every((result) => result.status === 'rejected')).toBe(true);
    expect(performance.now() - started).toBeLessThan(OPERATION_TIMEOUT_MS + SLACK_MS);
  });

  it('transaction en gec iki surede doner (geri alma sureyi yeniler) ve yarim kalmaz', async () => {
    proxy.freeze();

    expectTimeout(
      await timedFailure(() =>
        bounded.withTransaction(async (session) => {
          await items.insertOne({ _id: 'itm_tx', name: 'tx', count: 1 }, { session });
        }),
      ),
      OPERATION_TIMEOUT_MS * 2,
    );
    proxy.thaw();

    // Yolda kalan yazim transaction'in icindeydi; commit hic gonderilmedi.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await expect(directItems().countDocuments({ _id: 'itm_tx' })).resolves.toBe(0);
  });

  it('cozulunce toparlanir: ayni baglanti yeni islemleri hemen yapar', async () => {
    proxy.freeze();
    await timedFailure(() => items.findById('itm_1'));
    proxy.thaw();

    await items.insertOne({ _id: 'itm_2', name: 'sonra', count: 1 });
    await expect(items.findById('itm_2')).resolves.toMatchObject({ name: 'sonra' });
  });

  it('zaman asimi "yazilmadi" demek DEGILDIR: tekil yazim cozulunce uygulanabilir', async () => {
    proxy.freeze();
    expectTimeout(
      await timedFailure(() => items.insertOne({ _id: 'itm_late', name: 'gec', count: 1 })),
      OPERATION_TIMEOUT_MS,
    );
    proxy.thaw();

    // Cagiran hata aldi ama istek Mongo'ya ulasti: tekrar denemeye guvenli yazim gerekir.
    await expect(
      waitFor(async () => (await directItems().countDocuments({ _id: 'itm_late' })) === 1),
    ).resolves.toBe(true);
  });

  it('ping islem suresiyle sinirli: saglik yoklamasi donukken false doner', async () => {
    proxy.freeze();
    const started = performance.now();

    await expect(bounded.ping()).resolves.toBe(false);
    expect(performance.now() - started).toBeLessThan(OPERATION_TIMEOUT_MS + SLACK_MS);
  });

  it('sicak kayitta es zamanli yazim 120 sn degil islem suresinde biter', async () => {
    await directItems().insertOne({ _id: 'itm_hot', name: 'sicak', count: 0 });
    // Ayni belgeye yazip COMMIT ETMEDEN bekleyen baska bir transaction.
    const holder = direct.startSession();
    try {
      holder.startTransaction();
      await directItems().updateOne(
        { _id: 'itm_hot' },
        { $set: { count: 100 } },
        { session: holder },
      );

      expectTimeout(
        await timedFailure(() =>
          bounded.withTransaction((session) =>
            items.updateById('itm_hot', { $inc: { count: 1 } }, { session }),
          ),
        ),
        OPERATION_TIMEOUT_MS,
        // Surucu denemeler arasinda bekler (5-500 ms, rastgele); sonraki bekleme sureyi
        // asacaksa erken birakir. Ust sinir sure, alt sinir yok.
        0,
      );
      // P3 yolu degismedi: surucu denemezse kaybeden HEMEN CONFLICT alir.
      await expect(
        bounded.withTransaction(
          (session) => items.updateById('itm_hot', { $inc: { count: 1 } }, { session }),
          { retryTransientErrors: false },
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
    } finally {
      await holder.abortTransaction();
      await holder.endSession();
    }
  });
});

describe('toplu yazim sureli transaction icinde (#51, surucu hatasi)', () => {
  it('bulkCollection ile insertMany transaction icinde yazilir (siparis + outbox bicimi)', async () => {
    await bounded.withTransaction(async (session) => {
      await items.insertOne({ _id: 'itm_a', name: 'a', count: 1 }, { session });
      await items.insertMany(
        [
          { _id: 'itm_b', name: 'b', count: 1 },
          { _id: 'itm_c', name: 'c', count: 1 },
        ],
        { session },
      );
    });

    await expect(directItems().countDocuments()).resolves.toBe(3);
  });

  it('bulkCollection ile toplu yazim da transaction suresiyle sinirli: donukken iki surede doner', async () => {
    proxy.freeze();

    expectTimeout(
      await timedFailure(() =>
        bounded.withTransaction((session) =>
          items.insertMany([{ _id: 'itm_d', name: 'd', count: 1 }], { session }),
        ),
      ),
      OPERATION_TIMEOUT_MS * 2,
    );
  });

  it('kanarya: surucu miras alinan sureli tutamakla insertMany yi sureli transaction da hala reddediyor', async () => {
    // Surucu duzelince bu test kirmizi olur: bulkCollection ve eslint kurali
    // (getir/mongo-bulk-writes) o zaman kaldirilabilir.
    const failure = await bounded
      .withTransaction((session) =>
        bounded.db
          .collection<ItemDoc>(COLLECTION)
          .insertMany([{ _id: 'itm_e', name: 'e', count: 1 }], { session }),
      )
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: ERROR_CODES.INTERNAL });
    const cause = failure instanceof AppError ? failure.cause : undefined;
    expect(cause instanceof Error ? cause.message : '').toContain(
      'An operation cannot be given a timeoutMS setting',
    );
    await expect(directItems().countDocuments({ _id: 'itm_e' })).resolves.toBe(0);
  });
});

describe('acilis isleri suresiz (#51)', () => {
  it('indeks kurulumu islem suresine takilmaz: donukken bekler, cozulunce biter', async () => {
    proxy.freeze();
    const ensure = items.ensureIndexes();

    await expect(stillPending(ensure)).resolves.toBe(true);
    proxy.thaw();
    await expect(ensure).resolves.toBeUndefined();
  });

  it('goc calistiricisi suresiz gorunumu kullanir: donukken bekler, cozulunce uygular', async () => {
    const migration: Migration = {
      version: 1,
      name: 'ornek-alan-ekle',
      up: async ({ db, session }) => {
        await db
          .collection<ItemDoc>(COLLECTION)
          .insertOne(
            { _id: 'itm_goc', name: 'goc', count: 1 },
            session === undefined ? {} : { session },
          );
      },
      down: () => Promise.resolve(),
    };
    const runner = createMigrationRunner({
      connection: bounded,
      migrations: [migration],
      logger: silentLogger,
    });
    proxy.freeze();
    const applied = runner.up();

    await expect(stillPending(applied)).resolves.toBe(true);
    proxy.thaw();
    await expect(applied).resolves.toHaveLength(1);
    await expect(directItems().countDocuments({ _id: 'itm_goc' })).resolves.toBe(1);
  });
});
