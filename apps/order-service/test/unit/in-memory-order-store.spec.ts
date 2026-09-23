/**
 * Bellek deposu, Mongo ile AYNI sozlesmeden gecer (test/integration'da gercek Mongo).
 */

import { InMemoryOrderStore } from '../../src/infrastructure/memory/in-memory-order-store.js';
import { describeOrderStoreContract } from '../support/order-store-contract.js';

describeOrderStoreContract('bellek', () => new InMemoryOrderStore());
