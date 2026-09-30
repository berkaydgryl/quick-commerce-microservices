/**
 * Bellekteki rezervasyon (MOCK=true, B16) Redis'le AYNI sozlesmeden gecer;
 * Redis'teki ikizi test/integration/reservation.spec.ts'te.
 */

import { createInMemoryStock } from '../../src/infrastructure/memory/in-memory-stock.js';
import { describeReservationStoreContract } from '../support/reservation-store-contract.js';

describeReservationStoreContract('bellek', () => Promise.resolve(createInMemoryStock([])));
