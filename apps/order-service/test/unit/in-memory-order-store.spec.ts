/**
 * Bellek deposu, Mongo ile AYNI sozlesmeden gecer (test/integration'da gercek Mongo).
 */

import { InMemoryOrderStore } from '../../src/infrastructure/memory/in-memory-order-store.js';
import { describeOrderOutboxContract } from '../support/order-outbox-contract.js';
import { describeOrderStoreContract } from '../support/order-store-contract.js';

describeOrderStoreContract('bellek', () => new InMemoryOrderStore());
describeOrderOutboxContract(
  'bellek',
  () => {
    const store = new InMemoryOrderStore();
    return { repository: store, outbox: store };
  },
  (source) => {
    const store = new InMemoryOrderStore(source);
    return { repository: store, outbox: store };
  },
);
