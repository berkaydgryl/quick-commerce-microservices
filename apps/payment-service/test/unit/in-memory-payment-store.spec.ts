/**
 * Bellek deposu, Mongo uygulamasiyla AYNI sozlesmeden gecer; gercek Mongo
 * kosusu test/integration/mongo-payment-store.spec.ts icindedir.
 */

import { InMemoryPaymentStore } from '../../src/infrastructure/memory/in-memory-payment-store.js';
import { describePaymentStoreContract } from '../support/payment-store-contract.js';

describePaymentStoreContract('bellek', () => new InMemoryPaymentStore());
