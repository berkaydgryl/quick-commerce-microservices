/** Bellek deposu, Mongo uygulamasiyla AYNI sozlesmeden gecer (integration'da gercek Mongo). */

import { InMemoryRiskEventStore } from '../../src/infrastructure/memory/in-memory-risk-event-store.js';
import { describeRiskEventStoreContract } from '../support/risk-event-store-contract.js';

describeRiskEventStoreContract('bellek', () => new InMemoryRiskEventStore());
