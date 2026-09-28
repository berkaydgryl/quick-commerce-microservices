/**
 * ListCategories ve ListMarketCategories, gercek gRPC sunucusu uzerinden.
 */

import { ERROR_CODES, GRPC_STATUS } from '@getir/core';
import { catalogV1 } from '@getir/proto';
import { describe, expect, it } from 'vitest';

import { useCatalogGrpcServer } from '../../support/catalog-grpc-harness.js';
import { appErrorOf } from '@getir/service-kit/testing';

const call = useCatalogGrpcServer();

describe('ListCategories', () => {
  it('kategorileri vitrin sirasinda doner', async () => {
    const { error, response } = await call(catalogV1.CatalogServiceService.listCategories, {});

    expect(error).toBeUndefined();
    expect(response?.categories).toHaveLength(5);
    expect(response?.categories.map((item) => item.sortOrder)).toEqual([1, 2, 3, 4, 5]);
    expect(response?.categories[0]?.slug).toBe('sut-kahvaltilik');
  });
});

describe('ListMarketCategories', () => {
  it('manav yalnizca meyve-sebze', async () => {
    const { response } = await call(catalogV1.CatalogServiceService.listMarketCategories, {
      marketId: 'mkt_kardesler-manavi',
    });

    expect(response?.categories.map((category) => category.slug)).toEqual(['meyve-sebze']);
  });

  it('bicimi bozuk kimlik: NOT_FOUND degil INVALID_ARGUMENT (D6)', async () => {
    const { error } = await call(catalogV1.CatalogServiceService.listMarketCategories, {
      marketId: 'BAD!ID',
    });

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(appErrorOf(error)).toEqual({
      code: ERROR_CODES.VALIDATION_FAILED,
      details: { marketId: 'mkt_ onekli kimlik bekleniyor' },
    });
  });
});
