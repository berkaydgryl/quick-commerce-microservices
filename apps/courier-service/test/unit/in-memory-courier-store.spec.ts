/** Bellek deposu, Mongo uygulamasiyla AYNI sozlesmeden gecer (integration'da gercek Mongo). */

import { InMemoryCourierStore } from '../../src/infrastructure/memory/in-memory-courier-store.js';
import { describeCourierStoreContract } from '../support/courier-store-contract.js';
import { TEST_MARKETS } from '../support/couriers.js';

describeCourierStoreContract('bellek', (couriers) =>
  Promise.resolve(new InMemoryCourierStore(couriers, TEST_MARKETS)),
);
