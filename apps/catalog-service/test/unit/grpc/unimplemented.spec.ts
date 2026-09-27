/**
 * Sozlesmede duran ama uygulanmayan RPC'ler: deprecated olanlar yerini,
 * henuz yazilmayanlar geldigi gorevi soyler.
 */

import { GRPC_STATUS } from '@getir/core';
import { catalogV1 } from '@getir/proto';
import { describe, expect, it } from 'vitest';

import { useCatalogGrpcServer } from '../../support/catalog-grpc-harness.js';
import { demoLocation } from '../../support/demo-addresses.js';

const call = useCatalogGrpcServer();

describe('deprecated ve henuz yazilmamis RPC ler', () => {
  it('ResolveDarkStore UNIMPLEMENTED doner ve yerini soyler (ADR-15)', async () => {
    const { error } = await call(catalogV1.CatalogServiceService.resolveDarkStore, {
      location: demoLocation('Ev'),
    });

    expect(error?.code).toBe(GRPC_STATUS.UNIMPLEMENTED);
    expect(error?.details).toContain('ListNearbyMarkets');
  });

  it('BatchGetProducts UNIMPLEMENTED (deprecated) ve yerini soyler', async () => {
    const { error } = await call(catalogV1.CatalogServiceService.batchGetProducts, {
      ids: ['prd_sut-1l'],
      skus: [],
    });

    expect(error?.code).toBe(GRPC_STATUS.UNIMPLEMENTED);
    expect(error?.details).toContain('BatchGetOffers');
  });

  it('GetProduct UNIMPLEMENTED ve hangi gorevde gelecegini soyler', async () => {
    const { error } = await call(catalogV1.CatalogServiceService.getProduct, { id: 'prd_sut-1l' });

    expect(error?.code).toBe(GRPC_STATUS.UNIMPLEMENTED);
    expect(error?.details).toContain('T8.4');
  });
});
