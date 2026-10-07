/** routes deposunun bellek uygulamasi (T13.2): Mongo ile ayni sozlesme. */

import { InMemoryRouteStore } from '../../src/infrastructure/memory/in-memory-route-store.js';
import { describeMovingRouteStoreContract } from '../support/moving-route-store-contract.js';
import { describeRouteStoreContract } from '../support/route-store-contract.js';

describeRouteStoreContract('bellek', () => new InMemoryRouteStore());
describeMovingRouteStoreContract('bellek', () => new InMemoryRouteStore());
