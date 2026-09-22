/**
 * Bagimlilik kurulumu - elle (DI framework yok).
 *
 * Tek is: hangi uygulamanin hangi arayuzu karsiladigini SECMEK ve parcalari
 * birbirine baglamak. Burada is kurali, sorgu ya da protokol ayrintisi olmaz;
 * bu dosyayi okuyan biri servisin neyden olustugunu tek bakista gormeli.
 */

import type { Logger } from '@getir/core';
import { catalogV1 } from '@getir/proto';
import type { GrpcServiceRegistration } from '@getir/service-kit';

import { createListCategories } from './application/list-categories.js';
import { createListProducts } from './application/list-products.js';
import { CATALOG_SERVICE_FULL_NAME } from './config/constants.js';
import type { CatalogRepository } from './domain/catalog-repository.js';
import { InMemoryCatalogRepository } from './infrastructure/in-memory-catalog-repository.js';
import { createCatalogImplementation } from './interfaces/grpc/catalog-handlers.js';

export interface BootstrapOptions {
  readonly logger?: Logger;
  /**
   * Katalog kaynagi. Verilmezse bellekteki sahte veri kullanilir.
   * T4.1'de buraya MongoCatalogRepository gelecek; use-case'ler degismeyecek.
   */
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
