/**
 * order -> catalog gRPC istemcisi (T7.2), GERCEK tel uzerinden: sahte bir
 * catalog sunucusu ayaga kalkar. requestId iletimi, proto -> domain cevirisi,
 * hata cevirisi ve sure siniri denenir.
 */

import { AppError, ERROR_CODES, silentLogger } from '@getir/core';
import { catalogV1, commonV1 } from '@getir/proto';
import { REQUEST_ID_METADATA_KEY, startGrpcServer, toServiceError } from '@getir/service-kit';
import type { GrpcServerHandle } from '@getir/service-kit';
import type { sendUnaryData, ServerUnaryCall } from '@grpc/grpc-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ITEM_UNIT } from '../../src/domain/order-item.js';
import { GrpcCatalogPricing } from '../../src/infrastructure/catalog/grpc-catalog-pricing.js';

const TIMEOUT_MS = 200;
const SLOW_MARKET_ID = 'mkt_yavas';
const MISSING_MARKET_ID = 'mkt_olmayan';
const scope = { requestId: 'req_iletim_1', logger: silentLogger };

/** Sunucunun gordugu x-request-id degerleri. */
const seenRequestIds: string[] = [];

const tryMoney = (amountMinor: number, currency = 'TRY'): commonV1.Money => ({
  amountMinor,
  currency,
});

function offer(overrides: Partial<catalogV1.Offer>): catalogV1.Offer {
  return {
    id: 'ofr_1',
    marketId: 'mkt_migros-jet-moda',
    productId: 'prd_01',
    sku: 'SUT-1L',
    name: 'Süt 1 L',
    description: '',
    categoryId: 'cat_sut',
    unit: commonV1.Unit.UNIT_LITER,
    imageUrl: '',
    price: tryMoney(3_250),
    isActive: true,
    ...overrides,
  };
}

function record(call: ServerUnaryCall<unknown, unknown>): void {
  const raw = call.metadata.get(REQUEST_ID_METADATA_KEY)[0];
  seenRequestIds.push(typeof raw === 'string' ? raw : '');
}

const implementation = {
  getMarket: (
    call: ServerUnaryCall<catalogV1.GetMarketRequest, catalogV1.GetMarketResponse>,
    callback: sendUnaryData<catalogV1.GetMarketResponse>,
  ): void => {
    record(call);
    if (call.request.marketId === MISSING_MARKET_ID) {
      callback(toServiceError(AppError.notFound('Market bulunamadi')));
      return;
    }
    const respond = () =>
      callback(null, {
        market: {
          ...catalogV1.Market.fromPartial({ id: call.request.marketId, name: 'Migros Jet' }),
          pricingRules: {
            minBasket: tryMoney(5_000),
            deliveryFee: tryMoney(1_490),
            freeDeliveryThreshold: tryMoney(25_000),
          },
        },
      });
    // Yavas market: istemcinin sure sinirindan SONRA cevap verir.
    if (call.request.marketId === SLOW_MARKET_ID) setTimeout(respond, TIMEOUT_MS * 3);
    else respond();
  },
  batchGetOffers: (
    call: ServerUnaryCall<catalogV1.BatchGetOffersRequest, catalogV1.BatchGetOffersResponse>,
    callback: sendUnaryData<catalogV1.BatchGetOffersResponse>,
  ): void => {
    record(call);
    callback(null, {
      offers: [
        offer({}),
        // Bos para birimi: proto sozlesmesi geregi TRY sayilir.
        offer({
          productId: 'prd_02',
          sku: 'EKMEK-1',
          name: 'Ekmek',
          unit: commonV1.Unit.UNIT_PIECE,
          price: tryMoney(1_000, ''),
        }),
        // Pasif teklif satilmaz: istemci onu da elemeli.
        offer({ productId: 'prd_03', sku: 'PASIF-1', isActive: false }),
      ],
      missing: [],
    });
  },
};

let handle: GrpcServerHandle;
let catalog: GrpcCatalogPricing;

beforeAll(async () => {
  handle = await startGrpcServer({
    serviceName: 'fake-catalog',
    host: '127.0.0.1',
    port: 0,
    services: [
      {
        name: 'getir.catalog.v1.CatalogService',
        definition: catalogV1.CatalogServiceService,
        implementation,
      },
    ],
  });
  catalog = new GrpcCatalogPricing(`127.0.0.1:${handle.port}`, TIMEOUT_MS);
});

afterAll(async () => {
  catalog?.close();
  await handle?.shutdown('test bitti');
});

async function rejectionOf(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (error instanceof AppError) return error;
  throw new Error('AppError beklenirdi');
}

describe('GrpcCatalogPricing', () => {
  it('market kurallarini kurusa cevirir; requestId AYNEN iletilir', async () => {
    const rules = await catalog.marketRules('mkt_migros-jet-moda', scope);

    expect(rules).toEqual({
      minBasketMinor: 5_000,
      deliveryFeeMinor: 1_490,
      freeDeliveryThresholdMinor: 25_000,
    });
    expect(seenRequestIds.at(-1)).toBe(scope.requestId);
  });

  it('yalnizca aktif teklifleri doner; birim ve bos para birimi cevrilir', async () => {
    const offers = await catalog.activeOffers(
      'mkt_migros-jet-moda',
      ['prd_01', 'prd_02', 'prd_03'],
      scope,
    );

    expect(offers).toEqual([
      {
        productId: 'prd_01',
        sku: 'SUT-1L',
        name: 'Süt 1 L',
        unit: ITEM_UNIT.LITER,
        unitPriceMinor: 3_250,
        currency: 'TRY',
      },
      {
        productId: 'prd_02',
        sku: 'EKMEK-1',
        name: 'Ekmek',
        unit: ITEM_UNIT.PIECE,
        unitPriceMinor: 1_000,
        currency: 'TRY',
      },
    ]);
    expect(seenRequestIds.at(-1)).toBe(scope.requestId);
  });

  it("catalog'un is hatasi kodu korunur (x-app-error): NOT_FOUND", async () => {
    const error = await rejectionOf(catalog.marketRules(MISSING_MARKET_ID, scope));

    expect(error.code).toBe(ERROR_CODES.NOT_FOUND);
  });

  it('sure siniri dolarsa SERVICE_UNAVAILABLE (takilan catalog cagirani kilitlemez)', async () => {
    const error = await rejectionOf(catalog.marketRules(SLOW_MARKET_ID, scope));

    expect(error.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
  });

  it('catalog hic ayakta degilse SERVICE_UNAVAILABLE', async () => {
    const unreachable = new GrpcCatalogPricing('127.0.0.1:1', TIMEOUT_MS);
    try {
      const error = await rejectionOf(unreachable.marketRules('mkt_migros-jet-moda', scope));

      expect(error.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
    } finally {
      unreachable.close();
    }
  });
});
