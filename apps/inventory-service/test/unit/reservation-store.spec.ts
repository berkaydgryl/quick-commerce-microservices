/**
 * Bellekteki rezervasyon (MOCK=true, B16) Redis'le AYNI sozlesmeden gecer;
 * Redis'teki ikizi test/integration/reservation.spec.ts'te.
 */

import { createInMemoryStock } from '../../src/infrastructure/memory/in-memory-stock.js';
import { describeActiveRemainingContract } from '../support/reservation-active-remaining-contract.js';
import { describeExtendExpectedContract } from '../support/reservation-extend-expected-contract.js';
import { describeReservationStoreContract } from '../support/reservation-store-contract.js';

describeReservationStoreContract('bellek', () => Promise.resolve(createInMemoryStock([])));
describeExtendExpectedContract('bellek', () => Promise.resolve(createInMemoryStock([])));
describeActiveRemainingContract('bellek', () => Promise.resolve(createInMemoryStock([])));
