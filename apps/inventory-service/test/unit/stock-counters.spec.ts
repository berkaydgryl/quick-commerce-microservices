/** Bellekteki sayaclar (MOCK) sayac sozlesmesinden gecer; Redis ayni sozlesmeyi entegrasyonda. */

import { InMemoryStockCounters } from '../../src/infrastructure/memory/in-memory-stock-counters.js';
import { describeStockCounterContract } from '../support/stock-counter-contract.js';

describeStockCounterContract('bellek', () => Promise.resolve(new InMemoryStockCounters()));
