/** Kurye seed'i: dogrulama yazimdan once, production'da ret, yazilan kurye IDLE; market kopyasi da yazilir. */

import { ERROR_CODES, fixedClock } from '@getir/core';
import { describe, expect, it } from 'vitest';

import {
  assertValidMarkets,
  assertValidSeeds,
  createSeedCouriers,
} from '../../src/application/seed-couriers.js';
import type { Courier } from '../../src/domain/courier.js';
import { COURIER_STATUS } from '../../src/domain/courier.js';
import type { CourierSeed } from '../../src/domain/courier-seed.js';
import type { MarketLocation } from '../../src/domain/market-locator.js';
import { courierId, MARKET, NOW_MS, TEST_MARKETS } from '../support/couriers.js';

const seed = (order: number, fields: Partial<CourierSeed> = {}): CourierSeed => ({
  id: courierId(order),
  name: `Kurye ${order}`,
  location: { lat: 40.985, lng: 29.0275 },
  ...fields,
});

function recordingWriter() {
  const writes: { couriers: readonly Courier[]; markets: readonly MarketLocation[] }[] = [];
  return {
    writes,
    replaceAll: (couriers: readonly Courier[], markets: readonly MarketLocation[]) => {
      writes.push({ couriers, markets });
      return Promise.resolve();
    },
  };
}

describe('createSeedCouriers', () => {
  it('kuryeler IDLE, bosta beklemeleri ve konum anlari saatten; marketler ayni yazimda; sayilar doner', async () => {
    const writer = recordingWriter();
    const seeds = [seed(1), seed(2, { location: { lat: 41.0425, lng: 29.008 } })];

    const result = await createSeedCouriers({
      writer,
      seeds,
      markets: TEST_MARKETS,
      isProduction: false,
      clock: fixedClock(NOW_MS),
    })();

    expect(result).toEqual({ markets: TEST_MARKETS.length, couriers: 2 });
    expect(writer.writes).toEqual([
      {
        couriers: seeds.map((one) => ({
          id: one.id,
          name: one.name,
          status: COURIER_STATUS.IDLE,
          idleSince: new Date(NOW_MS),
          lastLocation: one.location,
          lastLocationAt: new Date(NOW_MS),
        })),
        markets: TEST_MARKETS,
      },
    ]);
  });

  it("production'da reddeder ve hicbir sey yazmaz", async () => {
    const writer = recordingWriter();

    await expect(
      createSeedCouriers({
        writer,
        seeds: [seed(1)],
        markets: TEST_MARKETS,
        isProduction: true,
        clock: fixedClock(NOW_MS),
      })(),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
    expect(writer.writes).toEqual([]);
  });

  it('gecersiz veri yazimdan ONCE durdurulur', async () => {
    const writer = recordingWriter();

    await expect(
      createSeedCouriers({
        writer,
        seeds: [seed(1), seed(1)],
        markets: TEST_MARKETS,
        isProduction: false,
        clock: fixedClock(NOW_MS),
      })(),
    ).rejects.toThrow('Ayni kurye iki kez');
    expect(writer.writes).toEqual([]);
  });
});

describe('assertValidSeeds', () => {
  it.each([
    ['kimlik bicimi', seed(1, { id: 'crr_1' }), 'Gecersiz kurye kimligi'],
    ['baska onek', seed(1, { id: `usr_${'0'.repeat(32)}` }), 'Gecersiz kurye kimligi'],
    ['bos ad', seed(1, { name: '  ' }), 'Kurye adi bos'],
    ['enlem', seed(1, { location: { lat: 91, lng: 29 } }), 'Gecersiz konum'],
  ])('%s reddedilir', (_name, bad, message) => {
    expect(() => assertValidSeeds([bad])).toThrow(message);
  });
});

describe('assertValidMarkets', () => {
  const market = (fields: Partial<MarketLocation> = {}): MarketLocation => ({
    marketId: MARKET,
    location: { lat: 40.985, lng: 29.0275 },
    ...fields,
  });

  it.each([
    ['market kimligi', [market({ marketId: 'migros' })], 'Gecersiz market kimligi'],
    ['konum', [market({ location: { lat: 40, lng: 181 } })], 'Gecersiz market konumu'],
    ['tekrar', [market(), market()], 'Ayni market iki kez'],
  ])('%s reddedilir', (_name, bad, message) => {
    expect(() => assertValidMarkets(bad)).toThrow(message);
  });

  it('gecerli liste gecer', () => {
    expect(() => assertValidMarkets(TEST_MARKETS)).not.toThrow();
  });
});
