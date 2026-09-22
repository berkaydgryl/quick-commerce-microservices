/**
 * Bagimlilik kurulumu - elle (DI framework yok).
 *
 * Tek is: hangi uygulamanin hangi arayuzu karsiladigini SECMEK ve parcalari
 * birbirine baglamak. Burada is kurali, sorgu ya da protokol ayrintisi olmaz;
 * bu dosyayi okuyan biri servisin neyden olustugunu tek bakista gormeli.
 */

import type { Logger } from '@getir/core';
import type { MongoEnv } from '@getir/mongo-kit';
import { connectMongo } from '@getir/mongo-kit';
import type { MongoConnection } from '@getir/mongo-kit';
import { catalogV1 } from '@getir/proto';
import type { GrpcServiceRegistration } from '@getir/service-kit';

import { createListCategories } from './application/list-categories.js';
import { createListProducts } from './application/list-products.js';
import { CATALOG_SERVICE_FULL_NAME, SERVICE_NAME } from './config/constants.js';
import type { CatalogRepository } from './domain/catalog-repository.js';
import { InMemoryCatalogRepository } from './infrastructure/in-memory-catalog-repository.js';
import { MongoCatalog } from './infrastructure/mongo/mongo-catalog.js';
import { createCatalogImplementation } from './interfaces/grpc/catalog-handlers.js';

export interface BootstrapOptions {
  readonly logger?: Logger;
  /** Katalog kaynagi. Verilmezse bellekteki demo verisi (MOCK modu) kullanilir. */
  readonly repository?: CatalogRepository;
}

/** Servisin gRPC'ye kayitli hali; startGrpcServer bunu oldugu gibi alir. */
export function buildCatalogService(options: BootstrapOptions = {}): GrpcServiceRegistration {
  const repository = options.repository ?? new InMemoryCatalogRepository();

  const implementation = createCatalogImplementation({
    listCategories: createListCategories({ repository }),
    listProducts: createListProducts({ repository }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });

  return {
    name: CATALOG_SERVICE_FULL_NAME,
    definition: catalogV1.CatalogServiceService,
    implementation,
  };
}

/** Secilen veri kaynagi ve (varsa) kapanista birakilacak baglanti. */
export interface CatalogSource {
  readonly repository: CatalogRepository;
  /** Gunlukte gorunen ad: hangi modda calisiyoruz? */
  readonly name: 'bellek (MOCK)' | 'mongo';
  /** Kapanista EN SON cagrilir (proje kurali: once cagrilar, sonra veritabani). */
  close(): Promise<void>;
}

/**
 * MOCK=true -> bellek; aksi halde Mongo. Mongo modunda indeksler acilista
 * olusturulur: sorgular (ozellikle 2dsphere) indekse dayanir ve indeks
 * yoksa ilk istek hata ile doner.
 */
export async function openCatalogSource(
  mongo: MongoEnv | undefined,
  logger: Logger,
): Promise<CatalogSource> {
  if (mongo === undefined) {
    return {
      repository: new InMemoryCatalogRepository(),
      name: 'bellek (MOCK)',
      close: () => Promise.resolve(),
    };
  }

  const connection: MongoConnection = await connectMongo({
    uri: mongo.MONGO_URI,
    dbName: mongo.MONGO_DB,
    serverSelectionTimeoutMs: mongo.MONGO_SERVER_SELECTION_TIMEOUT_MS,
    appName: SERVICE_NAME,
    logger,
  });

  const catalog = new MongoCatalog(connection);
  try {
    await catalog.ensureIndexes();
  } catch (error: unknown) {
    // Baglanti acik kalirsa process kapanmaz ve hata gizlenir.
    await connection.close();
    throw error;
  }

  return { repository: catalog, name: 'mongo', close: () => connection.close() };
}
