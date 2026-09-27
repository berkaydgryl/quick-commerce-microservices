/**
 * Siparis deposu SOZLESME testi: ayni senaryolar bellekte (unit) ve gercek
 * Mongo'da (integration) kosar. MOCK modu ile gercek mod ayni surum kontrolunu,
 * ayni hatalari ve ayni gecmis sirasini gostermeli.
 *
 * Iki portun sozlesmesi ayri dosyalardadir; burasi yalnizca ikisini ayni depo
 * ve ayni (benzersiz kullanici ureten) veri yardimcisiyla kosturur.
 */

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
}
