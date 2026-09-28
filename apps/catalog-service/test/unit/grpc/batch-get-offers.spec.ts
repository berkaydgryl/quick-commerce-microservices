/**
 * BatchGetOffers (T9.3): sepet dogrulamasinin toplu fiyat okumasi, gercek gRPC
 * sunucusu uzerinden. Use-case kurallari test/unit/batch-get-offers.spec.ts'te.
 */

import { ERROR_CODES, GRPC_STATUS } from '@getir/core';
import { catalogV1 } from '@getir/proto';
import { describe, expect, it } from 'vitest';

import { listProductsRequest, MIGROS_MODA } from '../../support/catalog-requests.js';
import { useCatalogGrpcServer } from '../../support/catalog-grpc-harness.js';
import { appErrorOf } from '@getir/service-kit/testing';

const call = useCatalogGrpcServer();

describe('BatchGetOffers (T9.3)', () => {
  it('satilabilir teklifler ve missing tek cevapta; fiyat kurus', async () => {
    const { error, response } = await call(catalogV1.CatalogServiceService.batchGetOffers, {
      marketId: MIGROS_MODA,
      productIds: ['prd_sut-1l', 'prd_camasir-suyu', 'prd_yok'],
    });

    expect(error).toBeUndefined();
    expect(
      response?.offers.map((offer) => [offer.productId, offer.price?.amountMinor, offer.isActive]),
    ).toEqual([['prd_sut-1l', 3490, true]]);
    expect(response?.missing).toEqual(['prd_camasir-suyu', 'prd_yok']);
  });

  it('T9.3 olcutu uctan uca: 50 kalemlik sepet TEK cagrida, semadan gecerek', async () => {
    const migros = await call(
      catalogV1.CatalogServiceService.listProducts,
      listProductsRequest({ page: { pageSize: 50, pageToken: '' } }),
    );
    const known = (migros.response?.offers ?? []).map((offer) => offer.productId);
    const unknown = Array.from({ length: 50 - known.length }, (_, index) => `prd_yok-${index}`);

    const { error, response } = await call(catalogV1.CatalogServiceService.batchGetOffers, {
      marketId: MIGROS_MODA,
      productIds: [...known, ...unknown],
    });

    expect(known).toHaveLength(15);
    expect(error).toBeUndefined();
    expect(response?.offers).toHaveLength(14);
    expect(response?.missing).toEqual(['prd_camasir-suyu', ...unknown]);
  });

  it('100 den fazla kimlik INVALID_ARGUMENT', async () => {
    const { error } = await call(catalogV1.CatalogServiceService.batchGetOffers, {
      marketId: MIGROS_MODA,
      productIds: Array.from({ length: 101 }, (_, index) => `prd_${index}`),
    });

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(appErrorOf(error)?.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('bos kimlik ve eksik market INVALID_ARGUMENT', async () => {
    const blankId = await call(catalogV1.CatalogServiceService.batchGetOffers, {
      marketId: MIGROS_MODA,
      productIds: ['prd_sut-1l', ' '],
    });
    const noMarket = await call(catalogV1.CatalogServiceService.batchGetOffers, {
      marketId: '',
      productIds: ['prd_sut-1l'],
    });

    expect(blankId.error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(noMarket.error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
  });

  it('bilinmeyen market NOT_FOUND', async () => {
    const { error } = await call(catalogV1.CatalogServiceService.batchGetOffers, {
      marketId: 'mkt_yok',
      productIds: ['prd_sut-1l'],
    });

    expect(error?.code).toBe(GRPC_STATUS.NOT_FOUND);
  });
});
