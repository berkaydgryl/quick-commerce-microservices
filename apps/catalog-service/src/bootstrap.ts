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

import { createBatchGetOffers } from './application/batch-get-offers.js';
import { createGetMarket } from './application/get-market.js';
import { createListCategories } from './application/list-categories.js';
import { createListMarketCategories } from './application/list-market-categories.js';
import { createListNearbyMarkets } from './application/list-nearby-markets.js';
import { createListProducts } from './application/list-products.js';
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
  const { categories, markets, offers } = options.readers ?? createInMemoryReaders();

  // Her use-case YALNIZCA ihtiyac duydugu portu alir.
  const implementation = createCatalogImplementation({
    listCategories: createListCategories({ categories }),
    listNearbyMarkets: createListNearbyMarkets({ markets }),
    getMarket: createGetMarket({ markets }),
    listMarketCategories: createListMarketCategories({ categories, markets, offers }),
    listProducts: createListProducts({ offers, markets }),
    batchGetOffers: createBatchGetOffers({ offers, markets }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });

  return {
    name: CATALOG_SERVICE_FULL_NAME,
    definition: catalogV1.CatalogServiceService,
    implementation,
  };
}
