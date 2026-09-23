/**
 * Bellek okuyuculari (MOCK modu) sozlesme testlerinden gecer. Ayni testler
 * Mongo uygulamasinda test/integration/mongo-catalog.spec.ts icinde kosar.
 */

import { AppError } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { CATALOG_SNAPSHOT } from '../../src/infrastructure/fixtures.js';
import { createInMemoryReaders } from '../../src/infrastructure/memory/in-memory-catalog.js';
import { describeCategoryReaderContract } from '../support/category-reader-contract.js';
import { describeMarketReaderContract } from '../support/market-reader-contract.js';
import { describeOfferReaderContract } from '../support/offer-reader-contract.js';

const readers = createInMemoryReaders();

describeCategoryReaderContract('bellek', () => readers.categories);
describeMarketReaderContract('bellek', () => readers.markets);
describeOfferReaderContract('bellek', () => readers.offers);

describe('bellek okuyuculari: veri hatasi', () => {
  it('olmayan urune isaret eden teklif acilista patlar (sessizce atlanmaz)', () => {
    const broken = {
      ...CATALOG_SNAPSHOT,
      offers: [
        { marketId: 'mkt_migros-jet-moda', productId: 'prd_yok', priceMinor: 100, isActive: true },
      ],
    };

    expect(() => createInMemoryReaders(broken)).toThrow(AppError);
  });
});
