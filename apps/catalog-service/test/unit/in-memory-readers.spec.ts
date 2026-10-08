/**
 * Bellek okuyuculari (MOCK modu) sozlesme testlerinden gecer. Ayni testler
 * Mongo uygulamasinda test/integration/mongo-catalog.spec.ts icinde kosar.
 */

import { AppError } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { createInMemoryReaders } from '../../src/infrastructure/memory/in-memory-catalog.js';
import { InMemoryMarketReader } from '../../src/infrastructure/memory/in-memory-market-reader.js';
import { describeCategoryReaderContract } from '../support/category-reader-contract.js';
import { describeCoveringLimitContract } from '../support/covering-limit-contract.js';
import { describeMarketReaderContract } from '../support/market-reader-contract.js';
import { describeOfferReaderContract } from '../support/offer-reader-contract.js';
import { CLASSIC_SNAPSHOT } from '../support/classic-catalog.js';

const readers = createInMemoryReaders(CLASSIC_SNAPSHOT);

describeCategoryReaderContract('bellek', () => readers.categories);
describeMarketReaderContract('bellek', () => readers.markets);
describeOfferReaderContract('bellek', () => readers.offers);
describeCoveringLimitContract('bellek', (markets) =>
  Promise.resolve(new InMemoryMarketReader(markets)),
);

describe('bellek okuyuculari: veri hatasi', () => {
  it('olmayan urune isaret eden teklif acilista patlar (sessizce atlanmaz)', () => {
    const broken = {
      ...CLASSIC_SNAPSHOT,
      offers: [
        { marketId: 'mkt_migros-jet-moda', productId: 'prd_yok', priceMinor: 100, isActive: true },
      ],
    };

    expect(() => createInMemoryReaders(broken)).toThrow(AppError);
  });
});
