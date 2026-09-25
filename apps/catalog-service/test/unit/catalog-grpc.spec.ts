/**
 * Uctan uca kapi testi: gercek gRPC sunucusu + gercek istemci.
 *
 * T3.1'in "bitti sayilir" olcutunun (grpcurl ile liste doner) ve T4.8'in
 * pazaryeri uclarinin (ADR-15) otomatik karsiligi budur. Dis bagimlilik yok - katalog verisi bellekte, sunucu
 * isletim sisteminin verdigi bos portta.
 */

import { ERROR_CODES, GRPC_STATUS } from '@getir/core';
import { catalogV1, commonV1 } from '@getir/proto';
import { ERROR_METADATA_KEY, startGrpcServer } from '@getir/service-kit';
import type { GrpcServerHandle } from '@getir/service-kit';
import { Client, credentials, Metadata } from '@grpc/grpc-js';
import type { MethodDefinition, ServiceError } from '@grpc/grpc-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildCatalogService } from '../../src/bootstrap.js';
import { demoLocation, EXPECTED_NEARBY } from '../support/demo-addresses.js';

/** Isletim sistemi bos bir port secsin; testler paralel kosarken cakismaz. */
const EPHEMERAL_PORT = 0;

let handle: GrpcServerHandle;
let client: Client;

interface CallResult<TResponse> {
  readonly error: ServiceError | undefined;
  readonly response: TResponse | undefined;
}

/** Sozlesmeden gelen serialize/deserialize ile tipli cagri. */
function call<TRequest, TResponse>(
  method: MethodDefinition<TRequest, TResponse>,
  request: TRequest,
): Promise<CallResult<TResponse>> {
  return new Promise((resolve) => {
    client.makeUnaryRequest(
      method.path,
      method.requestSerialize,
      method.responseDeserialize,
      request,
      new Metadata(),
      (error, response) => {
        resolve({ error: error ?? undefined, response: response ?? undefined });
      },
    );
  });
}

/** Hatanin metadata'sindaki AppError kodunu okur. */
function errorCodeOf(error: ServiceError | undefined): string | undefined {
  const raw = error?.metadata.get(ERROR_METADATA_KEY)[0];
  return typeof raw === 'string' ? (JSON.parse(raw) as { code: string }).code : undefined;
}

beforeAll(async () => {
  handle = await startGrpcServer({
    serviceName: 'catalog-test',
    host: '127.0.0.1',
    port: EPHEMERAL_PORT,
    services: [buildCatalogService()],
  });
  client = new Client(`127.0.0.1:${handle.port}`, credentials.createInsecure());
});

afterAll(async () => {
  client?.close();
  await handle?.shutdown('test bitti');
});

describe('ListCategories', () => {
  it('kategorileri vitrin sirasinda doner', async () => {
    const { error, response } = await call(catalogV1.CatalogServiceService.listCategories, {});

    expect(error).toBeUndefined();
    expect(response?.categories).toHaveLength(5);
    expect(response?.categories.map((item) => item.sortOrder)).toEqual([1, 2, 3, 4, 5]);
    expect(response?.categories[0]?.slug).toBe('sut-kahvaltilik');
  });
});

/** Hatanin x-app-error yukundeki ayrinti. */
function detailsOf(error: ServiceError | undefined): Record<string, string> | undefined {
  const raw = error?.metadata.get(ERROR_METADATA_KEY)[0];
  return typeof raw === 'string'
    ? (JSON.parse(raw) as { details?: Record<string, string> }).details
    : undefined;
}

const MIGROS_MODA = 'mkt_migros-jet-moda';

function listProductsRequest(
  overrides: Partial<catalogV1.ListProductsRequest>,
): catalogV1.ListProductsRequest {
  return {
    categoryId: '',
    darkStoreId: '',
    query: '',
    page: undefined,
    marketId: MIGROS_MODA,
    ...overrides,
  };
}

describe('ListNearbyMarkets', () => {
  it('Ev: Kadikoy marketleri yakindan uzaga, tam sayi metre', async () => {
    const { error, response } = await call(catalogV1.CatalogServiceService.listNearbyMarkets, {
      location: demoLocation('Ev'),
    });

    expect(error).toBeUndefined();
    expect(
      response?.markets.map((entry) => ({
        marketId: entry.market?.id,
        meters: entry.distanceMeters,
      })),
    ).toEqual(EXPECTED_NEARBY.Ev);
  });

  it('market bilgisi telde: puan TAM SAYI (47), kurallar kurus', async () => {
    const { response } = await call(catalogV1.CatalogServiceService.listNearbyMarkets, {
      location: demoLocation('Ev'),
    });
    const migros = response?.markets.find((entry) => entry.market?.id === MIGROS_MODA)?.market;

    expect(migros?.rating).toEqual({ averageTenths: 47, count: 1200 });
    expect(migros?.pricingRules?.minBasket).toEqual({ amountMinor: 4000, currency: 'TRY' });
    expect(migros?.deliveryTime).toEqual({ minMinutes: 15, maxMinutes: 25 });
    expect(migros?.logoUrl).toBe('/img/market/migros-jet.png');
  });

  it('Yazlik: BOS liste - "bolgende market yok" hata degil', async () => {
    const { error, response } = await call(catalogV1.CatalogServiceService.listNearbyMarkets, {
      location: demoLocation('Yazlık'),
    });

    expect(error).toBeUndefined();
    expect(response?.markets).toEqual([]);
  });

  it('konum verilmezse INVALID_ARGUMENT - (0,0) gibi islenmez', async () => {
    const { error } = await call(catalogV1.CatalogServiceService.listNearbyMarkets, {});

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(errorCodeOf(error)).toBe(ERROR_CODES.VALIDATION_FAILED);
  });
});

describe('GetMarket / ListMarketCategories', () => {
  it('GetMarket kapali marketi de dondurur', async () => {
    const { response } = await call(catalogV1.CatalogServiceService.getMarket, {
      marketId: 'mkt_a101-abbasaga',
    });

    expect(response?.market?.isOpen).toBe(false);
  });

  it('GetMarket bilinmeyen market NOT_FOUND', async () => {
    const { error } = await call(catalogV1.CatalogServiceService.getMarket, {
      marketId: 'mkt_yok',
    });

    expect(error?.code).toBe(GRPC_STATUS.NOT_FOUND);
    expect(detailsOf(error)).toEqual({ marketId: 'mkt_yok' });
  });

  it('ListMarketCategories: manav yalnizca meyve-sebze', async () => {
    const { response } = await call(catalogV1.CatalogServiceService.listMarketCategories, {
      marketId: 'mkt_kardesler-manavi',
    });

    expect(response?.categories.map((category) => category.slug)).toEqual(['meyve-sebze']);
  });
});

describe('ListProducts (teklifler)', () => {
  it('teklifleri o marketin fiyatiyla doner; deprecated products bos', async () => {
    const { response } = await call(
      catalogV1.CatalogServiceService.listProducts,
      listProductsRequest({}),
    );

    expect(response?.products).toEqual([]);
    expect(response?.offers).toHaveLength(15);
    expect(response?.page?.totalSize).toBe(15);
    const milk = response?.offers.find((offer) => offer.productId === 'prd_sut-1l');
    expect(milk?.price).toEqual({ amountMinor: 3490, currency: 'TRY' });
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
    expect(errorCodeOf(error)).toBe(ERROR_CODES.NOT_FOUND);
  });

  it('tek harflik aramayi INVALID_ARGUMENT ile reddeder', async () => {
    const { error } = await call(
      catalogV1.CatalogServiceService.listProducts,
      listProductsRequest({ query: 'a' }),
    );

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
  });
});

describe('BatchGetOffers (T9.3)', () => {
  it('satilabilir teklifler ve missing tek cevapta; fiyat kurus', async () => {
    const { error, response } = await call(catalogV1.CatalogServiceService.batchGetOffers, {
      marketId: 'mkt_migros-jet-moda',
      productIds: ['prd_sut-1l', 'prd_camasir-suyu', 'prd_yok'],
    });

    expect(error).toBeUndefined();
    expect(
      response?.offers.map((offer) => [offer.productId, offer.price?.amountMinor, offer.isActive]),
    ).toEqual([['prd_sut-1l', 3490, true]]);
    expect(response?.missing).toEqual(['prd_camasir-suyu', 'prd_yok']);
  });

  it('T9.3 olcutu uctan uca: 50 kalemlik sepet TEK cagrida, semadan gecerek', async () => {
    const migros = await call(catalogV1.CatalogServiceService.listProducts, {
      ...catalogV1.ListProductsRequest.fromPartial({}),
      marketId: 'mkt_migros-jet-moda',
      page: { pageSize: 50, pageToken: '' },
    });
    const known = (migros.response?.offers ?? []).map((offer) => offer.productId);
    const unknown = Array.from({ length: 50 - known.length }, (_, index) => `prd_yok-${index}`);

    const { error, response } = await call(catalogV1.CatalogServiceService.batchGetOffers, {
      marketId: 'mkt_migros-jet-moda',
      productIds: [...known, ...unknown],
    });

    expect(known).toHaveLength(15);
    expect(error).toBeUndefined();
    expect(response?.offers).toHaveLength(14);
    expect(response?.missing).toEqual(['prd_camasir-suyu', ...unknown]);
  });

  it('100 den fazla kimlik INVALID_ARGUMENT', async () => {
    const { error } = await call(catalogV1.CatalogServiceService.batchGetOffers, {
      marketId: 'mkt_migros-jet-moda',
      productIds: Array.from({ length: 101 }, (_, index) => `prd_${index}`),
    });

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(errorCodeOf(error)).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('bos kimlik ve eksik market INVALID_ARGUMENT', async () => {
    const blankId = await call(catalogV1.CatalogServiceService.batchGetOffers, {
      marketId: 'mkt_migros-jet-moda',
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

describe('deprecated ve henuz yazilmamis RPC ler', () => {
  it('ResolveDarkStore UNIMPLEMENTED doner ve yerini soyler (ADR-15)', async () => {
    const { error } = await call(catalogV1.CatalogServiceService.resolveDarkStore, {
      location: demoLocation('Ev'),
    });

    expect(error?.code).toBe(GRPC_STATUS.UNIMPLEMENTED);
    expect(error?.details).toContain('ListNearbyMarkets');
  });

  it('GetProduct UNIMPLEMENTED ve hangi gorevde gelecegini soyler', async () => {
    const { error } = await call(catalogV1.CatalogServiceService.getProduct, { id: 'prd_sut-1l' });

    expect(error?.code).toBe(GRPC_STATUS.UNIMPLEMENTED);
    expect(error?.details).toContain('T8.4');
  });
});
