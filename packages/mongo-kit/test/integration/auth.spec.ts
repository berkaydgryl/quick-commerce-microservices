/**
 * Servis basina kullanici (D14, ADR-05) gercek Mongo'da: kimlik dogrulamali
 * tek dugumlu replica set (yerel compose ile ayni kurulum: anahtar dosyasi +
 * kok kullanici). Servis kullanicisi admin veritabaninda tanimli ve YALNIZCA
 * kendi veritabaninda readWrite yetkili (infra/docker/mongo/init).
 */

import { AppError, ERROR_CODES } from '@getir/core';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { MongoClient } from 'mongodb';
import type { Db, IndexDescription } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo } from '../../src/client.js';
import type { MongoConnection } from '../../src/client.js';
import { MongoRepository } from '../../src/repository.js';
import type { BaseDocument } from '../../src/repository.js';

/** infra/docker/docker-compose.dev.yml ile ayni surum. */
const MONGO_IMAGE = 'mongo:7';
const MONGO_PORT = 27017;
const ROOT = { user: 'root', password: 'kok-parola' };
const CATALOG = { user: 'catalog', password: 'katalog-parola', db: 'getir_catalog' };
/** Baska servisin veritabani: catalog kullanicisinin orada yetkisi yok. */
const ORDER_DB = 'getir_order';

interface NoteDoc extends BaseDocument {
  text: string;
}

class NoteRepository extends MongoRepository<NoteDoc> {
  constructor(db: Db) {
    super(db, 'notes');
  }

  protected override indexes(): readonly IndexDescription[] {
    return [{ key: { text: 1 }, name: 'text_lookup' }];
  }
}

let container: StartedMongoDBContainer;
let catalog: MongoConnection;

/** Yerel .env'deki bicim: kullanicilar admin'de, topoloji kesfi kapali. */
function uriFor(user: string, password: string): string {
  const host = `${container.getHost()}:${container.getMappedPort(MONGO_PORT)}`;
  return `mongodb://${user}:${password}@${host}/?directConnection=true&authSource=admin`;
}

beforeAll(async () => {
  container = await new MongoDBContainer(MONGO_IMAGE)
    .withUsername(ROOT.user)
    .withPassword(ROOT.password)
    .start();
  const root = await MongoClient.connect(uriFor(ROOT.user, ROOT.password));
  try {
    await root.db('admin').command({
      createUser: CATALOG.user,
      pwd: CATALOG.password,
      roles: [{ role: 'readWrite', db: CATALOG.db }],
    });
    await root.db(ORDER_DB).collection<NoteDoc>('notes').insertOne({ _id: 'n1', text: 'siparis' });
  } finally {
    await root.close();
  }
  catalog = await connectMongo({
    uri: uriFor(CATALOG.user, CATALOG.password),
    dbName: CATALOG.db,
    appName: 'mongo-kit-yetki-testi',
  });
});

afterAll(async () => {
  await catalog?.close();
  await container?.stop();
});

describe('servis kullanicisi (D14)', () => {
  it('kendi veritabaninda indeks acar, yazar, okur ve transaction kullanir', async () => {
    const notes = new NoteRepository(catalog.db);
    await notes.ensureIndexes();

    await catalog.withTransaction(async (session) => {
      await notes.insertOne({ _id: 'c1', text: 'katalog' }, { session });
    });

    expect(await notes.findById('c1')).toEqual({ _id: 'c1', text: 'katalog' });
  });

  it('baska servisin veritabanini okuyamaz ve yazamaz: INTERNAL, sebebi adiyla', async () => {
    const orders = new NoteRepository(catalog.client.db(ORDER_DB));

    const read = await orders.findById('n1').catch((error: unknown) => error);
    const write = await orders.insertOne({ _id: 'n2', text: 'izinsiz' }).catch((e: unknown) => e);

    for (const error of [read, write]) {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        code: ERROR_CODES.INTERNAL,
        message: 'Veritabani yetkisi yok',
      });
    }
  });

  it('yanlis parola acilista durur: yeniden denenebilir hata DEGIL; parola mesaja girmez', async () => {
    const failure = await connectMongo({
      uri: uriFor(CATALOG.user, 'yanlis-parola'),
      dbName: CATALOG.db,
      serverSelectionTimeoutMs: 3_000,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AppError);
    const { code, message } = failure instanceof AppError ? failure : { code: '', message: '' };
    expect(code).toBe(ERROR_CODES.INTERNAL);
    expect(message).toContain('kimlik dogrulamasi reddedildi');
    expect(message).toContain('mongodb://***@');
    expect(message).not.toContain('yanlis-parola');
  });
});
