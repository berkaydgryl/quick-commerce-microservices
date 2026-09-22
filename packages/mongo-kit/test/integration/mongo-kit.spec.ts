/**
 * Gercek Mongo ile entegrasyon testi (Testcontainers).
 *
 * NEDEN KONTEYNER: iki davranis sahte istemciyle dogrulanamaz - benzersiz
 * indeksin gercekten ihlal edilmesi ve transaction'in gercekten geri alinmasi.
 * Ikisi de bu projede kritik: ilki stok_ledger'in cift kayit almasini engeller,
 * ikincisi outbox ile is verisinin birlikte yazilmasini garanti eder (ADR-04).
 *
 * MongoDBContainer tek dugumlu replica set baslatir; transaction'in sarti budur
 * (yerelde docker-compose ile ayni kurulum kullaniliyor).
 */

import { AppError, ERROR_CODES } from '@getir/core';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { Db, IndexDescription } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo } from '../../src/client.js';
import type { MongoConnection } from '../../src/client.js';
import { MongoRepository } from '../../src/repository.js';
import type { BaseDocument } from '../../src/repository.js';

/** infra/docker/docker-compose.dev.yml ile ayni surum. */
const MONGO_IMAGE = 'mongo:7';
const DB_NAME = 'getir_test';

/** Ornek belge: gercek bir koleksiyonun (products) kucultulmus hali. */
interface ProductDoc extends BaseDocument {
  sku: string;
  name: string;
  priceMinor: number;
}

class ProductRepository extends MongoRepository<ProductDoc> {
  constructor(db: Db) {
    super(db, 'test_products');
  }

  protected override indexes(): readonly IndexDescription[] {
    return [{ key: { sku: 1 }, unique: true, name: 'sku_unique' }];
  }

  /** Alt sinifin kendi sorgusu: taban sinif her seyi sarmalamaz. */
  async findBySku(sku: string): Promise<ProductDoc | null> {
    return this.findOne({ sku });
  }
}

let container: StartedMongoDBContainer;
let connection: MongoConnection;
let products: ProductRepository;

function product(id: string, sku: string): ProductDoc {
  return { _id: id, sku, name: `urun ${sku}`, priceMinor: 4599 };
}

beforeAll(async () => {
  container = await new MongoDBContainer(MONGO_IMAGE).start();
  connection = await connectMongo({
    // directConnection=true SART: konteyner replica set'i kendi ic adiyla
    // (hostname:27017) kaydeder; surucu topolojiyi kesfedip o adrese donmeye
    // calisir ve host makineden o ad cozulemez. Ayni gerekce
    // infra/docker/docker-compose.dev.yml icinde de yazili.
    uri: `${container.getConnectionString()}/?directConnection=true`,
    dbName: DB_NAME,
    appName: 'mongo-kit-test',
  });
  products = new ProductRepository(connection.db);
  await products.ensureIndexes();
});

afterEach(async () => {
  await connection.db.collection('test_products').deleteMany({});
});

afterAll(async () => {
  await connection?.close();
  await container?.stop();
});

describe('connectMongo', () => {
  it('baglanir ve ping doner', async () => {
    await expect(connection.ping()).resolves.toBe(true);
  });

  it('ulasilamayan adresi AppError ile bildirir', async () => {
    await expect(
      connectMongo({
        uri: 'mongodb://127.0.0.1:1/getir?directConnection=true',
        dbName: DB_NAME,
        serverSelectionTimeoutMs: 500,
      }),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe('MongoRepository', () => {
  it('yazar, okur, gunceller ve siler', async () => {
    await products.insertOne(product('prd_1', 'SUT-1L'));

    await expect(products.findById('prd_1')).resolves.toMatchObject({ sku: 'SUT-1L' });
    await expect(products.findBySku('SUT-1L')).resolves.toMatchObject({ _id: 'prd_1' });
    await expect(products.count()).resolves.toBe(1);

    await expect(products.updateById('prd_1', { $set: { priceMinor: 5200 } })).resolves.toBe(true);
    await expect(products.findById('prd_1')).resolves.toMatchObject({ priceMinor: 5200 });

    await expect(products.deleteById('prd_1')).resolves.toBe(true);
    await expect(products.findById('prd_1')).resolves.toBeNull();
  });

  it('olmayan kayitta false doner, hata firlatmaz', async () => {
    await expect(products.updateById('yok', { $set: { priceMinor: 1 } })).resolves.toBe(false);
    await expect(products.deleteById('yok')).resolves.toBe(false);
    await expect(products.exists({ sku: 'YOK-1' })).resolves.toBe(false);
  });

  it('benzersiz indeks ihlalini CONFLICT olarak cevirir', async () => {
    await products.insertOne(product('prd_1', 'SUT-1L'));

    // Ayni sku, farkli _id: indeks devrede olmasa bu kayit gecerdi.
    const duplicate = products.insertOne(product('prd_2', 'SUT-1L'));

    await expect(duplicate).rejects.toBeInstanceOf(AppError);
    await expect(duplicate).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
    await expect(products.count()).resolves.toBe(1);
  });

  it('ensureIndexes tekrar cagrilabilir', async () => {
    await expect(products.ensureIndexes()).resolves.toBeUndefined();

    const indexes = await connection.db.collection('test_products').indexes();
    expect(indexes.map((index) => index.name)).toContain('sku_unique');
  });
});

describe('withTransaction', () => {
  it('basarili iste iki yazim da kalici olur', async () => {
    await connection.withTransaction(async (session) => {
      await products.insertOne(product('prd_1', 'SUT-1L'), { session });
      await products.insertOne(product('prd_2', 'EKMEK-1'), { session });
    });

    await expect(products.count()).resolves.toBe(2);
  });

  it('hata durumunda HICBIR yazim kalmaz', async () => {
    const failing = connection.withTransaction(async (session) => {
      await products.insertOne(product('prd_1', 'SUT-1L'), { session });
      // Outbox kaydi yazilamadi diyelim: is verisi de geri alinmali (ADR-04).
      throw AppError.internal('outbox yazilamadi');
    });

    await expect(failing).rejects.toBeInstanceOf(AppError);
    await expect(products.count()).resolves.toBe(0);
  });

  it('transaction icindeki benzersiz indeks ihlali CONFLICT olarak kalir', async () => {
    // Onceki test INTERNAL firlattigi icin cift ceviriyi yakalayamiyordu:
    // INTERNAL -> INTERNAL fark edilmez. Burada hata surucuden gelir, run()
    // onu CONFLICT'e cevirir ve withTransaction'dan oyle cikmalidir.
    const failing = connection.withTransaction(async (session) => {
      await products.insertOne(product('prd_1', 'SUT-1L'), { session });
      await products.insertOne(product('prd_2', 'SUT-1L'), { session });
    });

    await expect(failing).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
    await expect(products.count()).resolves.toBe(0);
  });

  it('transaction sonucunu geri dondurur', async () => {
    const created = await connection.withTransaction(async (session) => {
      await products.insertOne(product('prd_3', 'CAY-500'), { session });
      return 'prd_3';
    });

    expect(created).toBe('prd_3');
  });
});
