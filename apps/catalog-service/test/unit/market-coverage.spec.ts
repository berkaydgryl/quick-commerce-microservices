import { describe, expect, it } from 'vitest';

import type { Market } from '../../src/domain/catalog.js';
import type { MarketDistance } from '../../src/domain/market-coverage.js';
import { coveringMarkets, evaluateCoverage } from '../../src/domain/market-coverage.js';
import { MARKETS } from '../../src/infrastructure/fixtures.js';

function templateMarket(): Market {
  const [first] = MARKETS;
  if (first === undefined) throw new Error('demo verisinde market yok');
  return first;
}

function market(id: string, radius: number, isOpen = true): Market {
  return { ...templateMarket(), id, deliveryRadiusMeters: radius, isOpen };
}

function at(target: Market, distance: number): MarketDistance {
  return { market: target, distanceMeters: distance };
}

describe('evaluateCoverage', () => {
  it('yaricap icinde ve acik -> serves; sinir dahil', () => {
    expect(evaluateCoverage(at(market('a', 2000), 500))).toBe('serves');
    expect(evaluateCoverage(at(market('a', 2000), 2000))).toBe('serves');
  });

  it('yaricap icinde ama kapali -> closed (rezervasyon STORE_CLOSED, T11.4)', () => {
    expect(evaluateCoverage(at(market('a', 2000, false), 500))).toBe('closed');
  });

  it('yaricap disi -> out-of-range; kapali olsa bile once mesafe', () => {
    expect(evaluateCoverage(at(market('a', 2000), 2001))).toBe('out-of-range');
    expect(evaluateCoverage(at(market('a', 2000, false), 9000))).toBe('out-of-range');
  });
});

describe('coveringMarkets', () => {
  it('yaricap icindekileri yakindan uzaga korur, KAPALILAR DAHIL', () => {
    const result = coveringMarkets([
      at(market('a', 2000), 300),
      at(market('b', 2000, false), 800),
      at(market('c', 500), 900),
    ]);

    expect(result.map((entry) => entry.market.id)).toEqual(['a', 'b']);
  });

  it('hic kapsayan yoksa bos liste', () => {
    expect(coveringMarkets([at(market('a', 2000), 71_000)])).toEqual([]);
  });
});
