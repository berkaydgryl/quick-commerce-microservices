/**
 * Siparis deposu SOZLESME testi: ayni senaryolar bellekte (unit) ve gercek
 * Mongo'da (integration) kosar. MOCK modu ile gercek mod ayni surum kontrolunu,
 * ayni hatalari ve ayni gecmis sirasini gostermeli.
 *
 * Portlarin sozlesmesi ayri dosyalardadir; burasi yalnizca hepsini ayni depo
 * ve ayni (benzersiz kullanici ureten) veri yardimcisiyla kosturur.
 */

import { describeExpiredOrderFinderContract } from './expired-order-finder-contract.js';
import { describeOrderHistoryReaderContract } from './order-history-reader-contract.js';
import { describeOrderRepositoryContract } from './order-repository-contract.js';
import type { OrderStoreUnderTest } from './order-store-fixtures.js';
import { createOrderStoreFixtures } from './order-store-fixtures.js';

export type { OrderStoreUnderTest } from './order-store-fixtures.js';

export function describeOrderStoreContract(
  name: string,
  getStore: () => OrderStoreUnderTest,
): void {
  const fixtures = createOrderStoreFixtures(name);
  describeOrderRepositoryContract(name, getStore, fixtures);
  describeOrderHistoryReaderContract(name, getStore, fixtures);
  describeExpiredOrderFinderContract(name, getStore, fixtures);
}
