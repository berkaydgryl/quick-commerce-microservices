/**
 * Kapsayan market sorgusu (#175; coveringMarketsPipeline): asama SIRASI birim
 * testte, calisan sorgu ve plani test/integration/market-covering-limit.spec.ts'te.
 */

import { describe, expect, it } from 'vitest';

import { coveringMarketsPipeline } from '../../src/infrastructure/mongo/market-repository.js';

describe('coveringMarketsPipeline (#175)', () => {
  it('$geoNear ILK (indeks), sonra marketin kendi yaricapiyla $match (sinir dahil), EN SON $limit', () => {
    const pipeline = coveringMarketsPipeline({ lat: 40.98, lng: 29.02 }, 20);

    expect(pipeline.map((stage) => Object.keys(stage)[0])).toEqual([
      '$geoNear',
      '$match',
      '$limit',
    ]);
    expect(pipeline[0]).toEqual({
      $geoNear: {
        near: { type: 'Point', coordinates: [29.02, 40.98] },
        distanceField: 'distanceMeters',
        spherical: true,
      },
    });
    expect(pipeline[1]).toEqual({
      $match: { $expr: { $lte: ['$distanceMeters', '$deliveryRadiusMeters'] } },
    });
    expect(pipeline[2]).toEqual({ $limit: 20 });
  });
});
