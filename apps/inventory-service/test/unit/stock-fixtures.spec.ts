/**
 * Demo stogu katalogla tutarli mi (T9.1)? Katalogdaki HER teklifin stok kaydi
 * olmali; stokta katalogda olmayan teklif olmamali. Biri degisip digeri
 * unutulursa gateway urun listesinde "bu markette satilmiyor" gorurdu.
 *
 * Test katalogun DEMO VERISINI okur (servis kodunu degil); her servis kendi
 * seed'ini yazar (ADR-05), tutarliligi bu test denetler.
 */

import { describe, expect, it } from 'vitest';

import { PRODUCTS } from '../../../catalog-service/src/infrastructure/fixtures/catalog-items.js';
import { OFFERS } from '../../../catalog-service/src/infrastructure/fixtures/offers.js';
import { assertValidLevels } from '../../src/application/seed-stock.js';
import { STOCK_LEVELS } from '../../src/infrastructure/fixtures/stock-levels.js';

const skuOf = new Map(PRODUCTS.map((product) => [product.id, product.sku]));
const catalogKeys = OFFERS.map(
  (offer) => `${offer.marketId}/${skuOf.get(offer.productId) ?? '?'}`,
).sort();
const stockKeys = STOCK_LEVELS.map((level) => `${level.marketId}/${level.sku}`).sort();

describe('demo stogu (T9.1)', () => {
  it('katalogdaki her teklifin stok kaydi var, fazlasi yok', () => {
    expect(stockKeys).toEqual(catalogKeys);
    expect(stockKeys).toHaveLength(71);
  });

  it('seed dogrulamasindan gecer (yinelenen, negatif, bicimsiz kayit yok)', () => {
    expect(() => assertValidLevels(STOCK_LEVELS)).not.toThrow();
  });

  it('her markette bir "tukendi" (0) ve bir "son 2 adet" kalemi var', () => {
    const markets = [...new Set(STOCK_LEVELS.map((level) => level.marketId))];
    for (const market of markets) {
      const counts = STOCK_LEVELS.filter((level) => level.marketId === market).map(
        (level) => level.onHand,
      );
      expect(counts, market).toContain(0);
      expect(counts, market).toContain(2);
    }
  });

  it('yaris senaryosu (T11.1): Migros Jet Moda cikolata 1 adet; digerleri 20-60', () => {
    const special = new Set([0, 1, 2]);
    expect(
      STOCK_LEVELS.find(
        (level) => level.marketId === 'mkt_migros-jet-moda' && level.sku === 'CIKOLATA-80',
      )?.onHand,
    ).toBe(1);
    expect(
      STOCK_LEVELS.filter((level) => !special.has(level.onHand)).every(
        (level) => level.onHand >= 20 && level.onHand <= 60,
      ),
    ).toBe(true);
  });
});
