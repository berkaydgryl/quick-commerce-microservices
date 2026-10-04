/** Havuz kurali (T13.2, domain/courier-pool.ts) ve mesafe (domain/geo.ts): saf. */

import { describe, expect, it } from 'vitest';

import {
  comparePoolCandidates,
  isWithinPool,
  proximityBand,
} from '../../src/domain/courier-pool.js';
import type { PoolCandidate } from '../../src/domain/courier-pool.js';
import { distanceMeters } from '../../src/domain/geo.js';
import {
  courier,
  FAR_MARKET_LOCATION,
  MARKET_LOCATION,
  northOf,
  POOL_RULE,
} from '../support/couriers.js';

const at = (minute: number): Date => new Date(Date.UTC(2026, 9, 4, 9, minute));

const candidate = (order: number, meters: number, idleMinute?: number): PoolCandidate => ({
  courier: courier(order, idleMinute === undefined ? {} : { idleSince: at(idleMinute) }),
  distanceMeters: meters,
});

const sorted = (candidates: PoolCandidate[]): number[] =>
  [...candidates]
    .sort((left, right) => comparePoolCandidates(left, right, POOL_RULE.bandMeters))
    .map((entry) => Number.parseInt(entry.courier.id.slice(4), 16));

describe('mesafe', () => {
  it('Moda - Besiktas ~6,6 km; kuzeye 1000 m tam 1000 m; ayni nokta 0', () => {
    expect(Math.round(distanceMeters(MARKET_LOCATION, FAR_MARKET_LOCATION))).toBe(6_607);
    expect(distanceMeters(MARKET_LOCATION, northOf(MARKET_LOCATION, 1_000))).toBeCloseTo(1_000, 6);
    expect(distanceMeters(MARKET_LOCATION, MARKET_LOCATION)).toBe(0);
  });
});

describe('havuz kurali', () => {
  it('dilim: 0-299 m 0, 300 m 1; yaricap siniri dahil', () => {
    expect([0, 299.9, 300, 899, 2_999].map((meters) => proximityBand(meters, 300))).toEqual([
      0, 0, 1, 2, 9,
    ]);
    expect(isWithinPool(3_000, POOL_RULE)).toBe(true);
    expect(isWithinPool(3_000.1, POOL_RULE)).toBe(false);
  });

  it('sira: dilim once; dilim icinde en uzun suredir bosta; alani olmayan en onde; esitlikte kimlik', () => {
    expect(
      sorted([
        candidate(1, 100, 5),
        candidate(2, 250, 1),
        candidate(3, 50, 3),
        candidate(4, 400, 0),
        candidate(5, 280),
        candidate(7, 1_100, 2),
        candidate(6, 1_150, 2),
      ]),
    ).toEqual([5, 2, 3, 1, 4, 6, 7]);
  });

  it('yakin ama yeni bosalan, ayni dilimdeki uzak ama uzun suredir bostaki kuryenin ONUNE gecmez (#88)', () => {
    expect(sorted([candidate(1, 10, 30), candidate(2, 290, 0)])).toEqual([2, 1]);
  });
});
