/**
 * Katalogun veri kaynagini ACAR: MOCK=true -> bellek, aksi halde Mongo.
 *
 * NEDEN BURADA (bootstrap'ta degil): Mongo'ya baglanmak, indeks kurmak ve
 * hata olursa baglantiyi birakmak altyapi isidir. Onceki surumde bu kod
 * bootstrap.ts'teydi; o dosyanin tek isi parcalari BAGLAMAK.
 */

import type { Logger } from '@getir/core';
import { connectMongo } from '@getir/mongo-kit';
import type { MongoEnv } from '@getir/mongo-kit';

import { SERVICE_NAME } from '../config/constants.js';
import type { CategoryReader } from '../domain/category-reader.js';
import type { MarketReader } from '../domain/market-reader.js';
import type { OfferReader } from '../domain/offer-reader.js';
import { createInMemoryReaders } from './memory/in-memory-catalog.js';
import { createMongoCatalogRepositories, ensureCatalogIndexes } from './mongo/mongo-catalog.js';

/** Servisin okudugu uc port. Use-case'ler bunlardan YALNIZCA ihtiyacini alir. */
export interface CatalogReaders {
  readonly categories: CategoryReader;
  readonly markets: MarketReader;
  readonly offers: OfferReader;
}

export interface CatalogSource {
  readonly readers: CatalogReaders;
  /** Gunlukte gorunen ad: hangi modda calisiyoruz? */
  readonly name: 'bellek (MOCK)' | 'mongo';
  /** Kapanista EN SON cagrilir (proje kurali: once cagrilar, sonra veritabani). */
  close(): Promise<void>;
}

/**
 * Mongo modunda indeksler acilista olusturulur: sorgular (ozellikle
 * 2dsphere) indekse dayanir ve indeks yoksa ilk istek hata ile doner.
 */
export async function openCatalogSource(
  mongo: MongoEnv | undefined,
  logger: Logger,
): Promise<CatalogSource> {
  if (mongo === undefined) {
    return {
      readers: createInMemoryReaders(),
      name: 'bellek (MOCK)',
      close: () => Promise.resolve(),
    };
  }

  const connection = await connectMongo({
    uri: mongo.MONGO_URI,
    dbName: mongo.MONGO_DB,
    serverSelectionTimeoutMs: mongo.MONGO_SERVER_SELECTION_TIMEOUT_MS,
    appName: SERVICE_NAME,
    logger,
  });

  const repositories = createMongoCatalogRepositories(connection.db);
  try {
    await ensureCatalogIndexes(repositories);
  } catch (error: unknown) {
    // Baglanti acik kalirsa process kapanmaz ve hata gizlenir.
    await connection.close();
    throw error;
  }

  const readers: CatalogReaders = {
    categories: repositories.categories,
    markets: repositories.markets,
    offers: repositories.offers,
  };
  return { readers, name: 'mongo', close: () => connection.close() };
}
