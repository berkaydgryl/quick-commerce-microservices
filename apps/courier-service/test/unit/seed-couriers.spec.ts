/** Kurye seed'i: dogrulama yazimdan once, production'da ret, yazilan kurye IDLE. */

import { ERROR_CODES, fixedClock } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { assertValidSeeds, createSeedCouriers } from '../../src/application/seed-couriers.js';
import type { Courier } from '../../src/domain/courier.js';
import { COURIER_STATUS } from '../../src/domain/courier.js';
import type { CourierSeed } from '../../src/domain/courier-seed.js';
import { courierId, MARKET, NOW_MS, OTHER_MARKET } from '../support/couriers.js';

const seed = (order: number, fields: Partial<CourierSeed> = {}): CourierSeed => ({
  id: courierId(order),
  name: `Kurye ${order}`,
  marketId: MARKET,
  location: { lat: 40.985, lng: 29.0275 },
  ...fields,
});

function recordingWriter() {
  const writes: (readonly Courier[])[] = [];
  return {
    writes,
    replaceAll: (couriers: readonly Courier[]) => {
      writes.push(couriers);
      return Promise.resolve();
    },
  };
}

describe('createSeedCouriers', () => {
  it('kuryeler IDLE, konumlari seed konumu ve ani saatten; sayilar doner', async () => {
    const writer = recordingWriter();
    const seeds = [seed(1), seed(2, { marketId: OTHER_MARKET })];

    const result = await createSeedCouriers({
      writer,
      seeds,
      isProduction: false,
      clock: fixedClock(NOW_MS),
    })();

    expect(result).toEqual({ markets: 2, couriers: 2 });
    expect(writer.writes).toEqual([
      seeds.map((one) => ({
        id: one.id,
        name: one.name,
        marketId: one.marketId,
        status: COURIER_STATUS.IDLE,
        lastLocation: one.location,
        lastLocationAt: new Date(NOW_MS),
      })),
    ]);
  });

  it("production'da reddeder ve hicbir sey yazmaz", async () => {
    const writer = recordingWriter();

    await expect(
      createSeedCouriers({
        writer,
        seeds: [seed(1)],
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
    ['market kimligi', seed(1, { marketId: 'migros' }), 'Gecersiz market kimligi'],
    ['bos ad', seed(1, { name: '  ' }), 'Kurye adi bos'],
    ['enlem', seed(1, { location: { lat: 91, lng: 29 } }), 'Gecersiz konum'],
  ])('%s reddedilir', (_name, bad, message) => {
    expect(() => assertValidSeeds([bad])).toThrow(message);
  });
});
