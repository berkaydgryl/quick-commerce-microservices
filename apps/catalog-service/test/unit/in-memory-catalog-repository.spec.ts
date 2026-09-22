/**
 * Bellek uygulamasi (MOCK modu) sozlesme testinden gecer. Ayni test Mongo
 * uygulamasinda test/integration/mongo-catalog.spec.ts icinde kosar.
 */

import { InMemoryCatalogRepository } from '../../src/infrastructure/in-memory-catalog-repository.js';
import { describeCatalogRepositoryContract } from '../support/catalog-repository-contract.js';

const repository = new InMemoryCatalogRepository();

describeCatalogRepositoryContract('bellek', () => repository);
