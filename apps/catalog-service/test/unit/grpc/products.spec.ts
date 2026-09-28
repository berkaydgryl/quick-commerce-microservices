/**
 * ListProducts: marketin teklifleri (ADR-15), gercek gRPC sunucusu uzerinden.
 */

import { CURRENCY, ERROR_CODES, GRPC_STATUS } from '@getir/core';
import { catalogV1, commonV1 } from '@getir/proto';
import { describe, expect, it } from 'vitest';

import { listProductsRequest } from '../../support/catalog-requests.js';
import { useCatalogGrpcServer } from '../../support/catalog-grpc-harness.js';
import { appErrorOf } from '@getir/service-kit/testing';

const call = useCatalogGrpcServer();

describe('ListProducts (teklifler)', () => {
  it('teklifleri o marketin fiyatiyla doner; deprecated products bos', async () => {
    const { response } = await call(
      catalogV1.CatalogServiceService.listProducts,
      listProductsRequest(),
    );

    expect(response?.products).toEqual([]);
    expect(response?.offers).toHaveLength(15);
    expect(response?.page?.totalSize).toBe(15);
    const milk = response?.offers.find((offer) => offer.productId === 'prd_sut-1l');
    expect(milk?.price).toEqual({ amountMinor: 3490, currency: CURRENCY });
    expect(milk?.unit).toBe(commonV1.Unit.UNIT_LITER);
  });

  it('ayni urun baska markette farkli fiyat (ADR-15)', async () => {
    const { response } = await call(
      catalogV1.CatalogServiceService.listProducts,
      listProductsRequest({ marketId: 'mkt_a101-caferaga', query: 'süt 1' }),
    );

    expect(
      response?.offers.find((offer) => offer.productId === 'prd_sut-1l')?.price?.amountMinor,
    ).toBe(3210);
  });

  it('imlecle ikinci sayfayi doner', async () => {
    const first = await call(
      catalogV1.CatalogServiceService.listProducts,
      listProductsRequest({ page: { pageSize: 10, pageToken: '' } }),
    );
    const second = await call(
      catalogV1.CatalogServiceService.listProducts,
      listProductsRequest({
        page: { pageSize: 10, pageToken: first.response?.page?.nextPageToken ?? '' },
      }),
    );

    expect(second.response?.offers).toHaveLength(5);
    expect(second.response?.page?.nextPageToken).toBe('');
  });

  it('market verilmezse INVALID_ARGUMENT', async () => {
    const { error } = await call(
      catalogV1.CatalogServiceService.listProducts,
      listProductsRequest({ marketId: '' }),
    );

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
  });

  it('bilinmeyen market NOT_FOUND', async () => {
    const { error } = await call(
      catalogV1.CatalogServiceService.listProducts,
      listProductsRequest({ marketId: 'mkt_yok' }),
    );

    expect(error?.code).toBe(GRPC_STATUS.NOT_FOUND);
    expect(appErrorOf(error)?.code).toBe(ERROR_CODES.NOT_FOUND);
  });

  it('tek harflik aramayi INVALID_ARGUMENT ile reddeder', async () => {
    const { error } = await call(
      catalogV1.CatalogServiceService.listProducts,
      listProductsRequest({ query: 'a' }),
    );

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
  });

  // D6: onceki surumde uc istek de REST sozlesmesinden gevsekti.
  it.each([
    ['bicimi bozuk kategori (bos liste degil)', { categoryId: 'sut' }, 'categoryId'],
    ['65 karakterlik arama', { query: 'a'.repeat(65) }, 'query'],
    ['bicimi bozuk market (NOT_FOUND degil)', { marketId: 'BAD!ID' }, 'marketId'],
  ])('%s: INVALID_ARGUMENT, alan details te', async (_name, overrides, field) => {
    const { error } = await call(
      catalogV1.CatalogServiceService.listProducts,
      listProductsRequest(overrides),
    );
    const appError = appErrorOf(error);

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(appError?.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(Object.keys(appError?.details ?? {})).toEqual([field]);
  });
});
