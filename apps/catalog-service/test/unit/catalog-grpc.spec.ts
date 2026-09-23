/**
 * Uctan uca kapi testi: gercek gRPC sunucusu + gercek istemci.
 *
 * T3.1'in "bitti sayilir" olcutunun (grpcurl ile liste doner) otomatik
 * karsiligi budur. Dis bagimlilik yok - katalog verisi bellekte, sunucu
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
import { demoLocation, EXPECTED_NEAREST } from '../support/demo-addresses.js';

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

describe('ListProducts', () => {
  it('urunleri ve sayfa bilgisini doner', async () => {
    const { response } = await call(catalogV1.CatalogServiceService.listProducts, {
      categoryId: '',
      darkStoreId: '',
      // T4.7: yeni zorunlu alan; catalog T4.8'e kadar dark store modeliyle calisir.
      marketId: '',
      query: '',
      page: undefined,
    });

    expect(response?.products).toHaveLength(15);
    expect(response?.page?.totalSize).toBe(15);
    expect(response?.page?.nextPageToken).toBe('');
  });

  it('fiyati KURUS cinsinden ve para birimi dolu doner', async () => {
    const { response } = await call(catalogV1.CatalogServiceService.listProducts, {
      categoryId: '',
      darkStoreId: '',
      // T4.7: yeni zorunlu alan; catalog T4.8'e kadar dark store modeliyle calisir.
      marketId: '',
      query: 'Süt 1 L',
      page: undefined,
    });

    const product = response?.products[0];
    expect(product?.price).toEqual({ amountMinor: 3490, currency: 'TRY' });
    expect(product?.unit).toBe(commonV1.Unit.UNIT_LITER);
  });

  it('imlecle ikinci sayfayi doner', async () => {
    const first = await call(catalogV1.CatalogServiceService.listProducts, {
      categoryId: '',
      darkStoreId: '',
      // T4.7: yeni zorunlu alan; catalog T4.8'e kadar dark store modeliyle calisir.
      marketId: '',
      query: '',
      page: { pageSize: 10, pageToken: '' },
    });
    const token = first.response?.page?.nextPageToken ?? '';

    const second = await call(catalogV1.CatalogServiceService.listProducts, {
      categoryId: '',
      darkStoreId: '',
      // T4.7: yeni zorunlu alan; catalog T4.8'e kadar dark store modeliyle calisir.
      marketId: '',
      query: '',
      page: { pageSize: 10, pageToken: token },
    });

    expect(first.response?.products).toHaveLength(10);
    expect(token).not.toBe('');
    expect(second.response?.products).toHaveLength(5);
    expect(second.response?.page?.nextPageToken).toBe('');
  });

  it('bilinmeyen depoyu NOT_FOUND ile reddeder', async () => {
    const { error } = await call(catalogV1.CatalogServiceService.listProducts, {
      categoryId: '',
      darkStoreId: 'ds_yok',
      // T4.7: yeni zorunlu alan; catalog T4.8'e kadar dark store modeliyle calisir.
      marketId: '',
      query: '',
      page: undefined,
    });

    expect(error?.code).toBe(GRPC_STATUS.NOT_FOUND);
    expect(errorCodeOf(error)).toBe(ERROR_CODES.NOT_FOUND);
  });

  it('tek harflik aramayi INVALID_ARGUMENT ile reddeder', async () => {
    const { error } = await call(catalogV1.CatalogServiceService.listProducts, {
      categoryId: '',
      darkStoreId: '',
      // T4.7: yeni zorunlu alan; catalog T4.8'e kadar dark store modeliyle calisir.
      marketId: '',
      query: 'a',
      page: undefined,
    });

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(errorCodeOf(error)).toBe(ERROR_CODES.VALIDATION_FAILED);
  });
});

describe('ResolveDarkStore', () => {
  /** Hatanin x-app-error yukundeki ayrinti (NO_STORE: reason + mesafe). */
  function detailsOf(error: ServiceError | undefined): Record<string, string> | undefined {
    const raw = error?.metadata.get(ERROR_METADATA_KEY)[0];
    return typeof raw === 'string'
      ? (JSON.parse(raw) as { details?: Record<string, string> }).details
      : undefined;
  }

  it('Ev adresi Kadikoy deposuna duser; mesafe tam sayi metre', async () => {
    const { error, response } = await call(catalogV1.CatalogServiceService.resolveDarkStore, {
      location: demoLocation('Ev'),
    });

    expect(error).toBeUndefined();
    expect(response?.darkStore?.id).toBe('ds_kadikoy');
    expect(response?.darkStore?.location).toEqual({ lat: 40.9903, lng: 29.0275 });
    expect(response?.distanceMeters).toBe(EXPECTED_NEAREST.Ev.meters);
  });

  it('yaricap disindaki konum NO_STORE (NOT_FOUND) + en yakin mesafe', async () => {
    // T4.2 olcutu. Yazlik (Sile): en yakin depo ~71 km.
    const { error } = await call(catalogV1.CatalogServiceService.resolveDarkStore, {
      location: demoLocation('Yazlık'),
    });

    expect(error?.code).toBe(GRPC_STATUS.NOT_FOUND);
    expect(errorCodeOf(error)).toBe(ERROR_CODES.NO_STORE);
    expect(detailsOf(error)).toEqual({
      reason: 'OUT_OF_RANGE',
      nearest_distance_meters: String(EXPECTED_NEAREST.Yazlık.meters),
    });
  });

  it('konum verilmezse INVALID_ARGUMENT - (0,0) gibi islenmez', async () => {
    const { error } = await call(catalogV1.CatalogServiceService.resolveDarkStore, {});

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(errorCodeOf(error)).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('WGS84 disindaki koordinat reddedilir', async () => {
    const { error } = await call(catalogV1.CatalogServiceService.resolveDarkStore, {
      location: { lat: 91, lng: 29 },
    });

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
  });
});

describe('henuz yazilmamis RPC ler', () => {
  it('UNIMPLEMENTED doner ve hangi gorevde gelecegini soyler', async () => {
    const { error } = await call(catalogV1.CatalogServiceService.getProduct, { id: 'prd_01' });

    expect(error?.code).toBe(GRPC_STATUS.UNIMPLEMENTED);
    expect(error?.details).toContain('GetProduct');
  });
});
