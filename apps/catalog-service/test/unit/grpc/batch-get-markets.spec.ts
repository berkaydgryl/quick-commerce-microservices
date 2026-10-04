/**
 * BatchGetMarkets (T11.13): favori isletmeler sayfasinin toplu market
 * okumasi, gercek gRPC sunucusu uzerinden. Use-case kurallari
 * test/unit/batch-get-markets.spec.ts'te.
 */

import { ERROR_CODES, GRPC_STATUS } from '@getir/core';
import { catalogV1 } from '@getir/proto';
import { appErrorOf } from '@getir/service-kit/testing';
import { describe, expect, it } from 'vitest';

import { MAX_BATCH_MARKET_IDS } from '../../../src/config/constants.js';
import { useCatalogGrpcServer } from '../../support/catalog-grpc-harness.js';

const call = useCatalogGrpcServer();

describe('BatchGetMarkets (T11.13)', () => {
  it('marketler istek sirasinda, telde tur ve kapakla; missing ayri', async () => {
    const { error, response } = await call(catalogV1.CatalogServiceService.batchGetMarkets, {
      marketIds: ['mkt_moda-kasabi', 'mkt_yok', 'mkt_a101-abbasaga'],
    });

    expect(error).toBeUndefined();
    expect(
      response?.markets.map((market) => [
        market.id,
        market.storeType,
        market.isOpen,
        market.coverUrl,
      ]),
    ).toEqual([
      ['mkt_moda-kasabi', catalogV1.StoreType.STORE_TYPE_KASAP, true, '/img/market/kasap.jpg'],
      ['mkt_a101-abbasaga', catalogV1.StoreType.STORE_TYPE_MARKET, false, '/img/market/market.jpg'],
    ]);
    expect(response?.missing).toEqual(['mkt_yok']);
  });

  it(`${MAX_BATCH_MARKET_IDS} kimlik tek cagrida gecer, bir fazlasi INVALID_ARGUMENT`, async () => {
    const ids = (count: number) => Array.from({ length: count }, (_, index) => `mkt_${index}`);

    const limit = await call(catalogV1.CatalogServiceService.batchGetMarkets, {
      marketIds: ids(MAX_BATCH_MARKET_IDS),
    });
    expect(limit.error).toBeUndefined();
    expect(limit.response?.missing).toHaveLength(MAX_BATCH_MARKET_IDS);

    const over = await call(catalogV1.CatalogServiceService.batchGetMarkets, {
      marketIds: ids(MAX_BATCH_MARKET_IDS + 1),
    });
    expect(over.error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(appErrorOf(over.error)?.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('bos kimlik INVALID_ARGUMENT; bos liste bos cevap', async () => {
    const blank = await call(catalogV1.CatalogServiceService.batchGetMarkets, {
      marketIds: ['mkt_sok-moda', '  '],
    });
    expect(blank.error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);

    const empty = await call(catalogV1.CatalogServiceService.batchGetMarkets, { marketIds: [] });
    expect(empty.error).toBeUndefined();
    expect(empty.response).toEqual({ markets: [], missing: [] });
  });
});
