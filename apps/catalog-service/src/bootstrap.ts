/**
 * Bagimlilik kurulumu - elle (DI framework yok).
 *
 * Tek is: hangi uygulamanin hangi arayuzu karsiladigini SECMEK ve parcalari
 * birbirine baglamak. Burada is kurali, sorgu, baglanti ya da protokol
 * ayrintisi olmaz; veri kaynagi infrastructure/catalog-source.ts'te acilir.
 */

import type { Logger } from '@getir/core';
import { catalogV1 } from '@getir/proto';
import type { GrpcServiceRegistration } from '@getir/service-kit';

import { createListCategories } from './application/list-categories.js';
import { createListProducts } from './application/list-products.js';
import { createResolveDarkStore } from './application/resolve-dark-store.js';
import { CATALOG_SERVICE_FULL_NAME } from './config/constants.js';
import type { CatalogReaders } from './infrastructure/catalog-source.js';
import { createInMemoryReaders } from './infrastructure/memory/in-memory-catalog.js';
import { createCatalogImplementation } from './interfaces/grpc/catalog-handlers.js';

export interface BootstrapOptions {
  readonly logger?: Logger;
  /** Katalog kaynagi. Verilmezse bellekteki demo verisi (MOCK modu) kullanilir. */
  readonly readers?: CatalogReaders;
}

/** Servisin gRPC'ye kayitli hali; startGrpcServer bunu oldugu gibi alir. */
export function buildCatalogService(options: BootstrapOptions = {}): GrpcServiceRegistration {
  const { categories, products, darkStores } = options.readers ?? createInMemoryReaders();

  // Her use-case YALNIZCA ihtiyac duydugu portu alir.
  const implementation = createCatalogImplementation({
    listCategories: createListCategories({ categories }),
    listProducts: createListProducts({ products, darkStores }),
    resolveDarkStore: createResolveDarkStore({ darkStores }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });

  return {
    name: CATALOG_SERVICE_FULL_NAME,
    definition: catalogV1.CatalogServiceService,
    implementation,
  };
}
