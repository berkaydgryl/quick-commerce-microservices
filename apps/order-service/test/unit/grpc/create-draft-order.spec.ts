/**
 * CreateDraftOrder kapi testi: gercek gRPC sunucusu + gercek istemci.
 * T3.2'nin "bitti sayilir" olcutunun (grpcurl ile orderId doner) otomatik karsiligi.
 */

import { AppError, ERROR_CODES, GRPC_STATUS } from '@getir/core';
import { orderV1 } from '@getir/proto';
import { describe, expect, it } from 'vitest';

import { FakeCatalogPricing } from '../../support/fake-catalog-pricing.js';
import { appErrorOf } from '@getir/service-kit/testing';
import { DRAFT_TOTAL_MINOR, draftRequest } from '../../support/order-fixtures.js';
import { useOrderGrpcServer } from '../../support/order-grpc-harness.js';

const call = useOrderGrpcServer();

// Ayri sunucu: catalog'a ulasilamayan order.
const unreachableCatalog = new FakeCatalogPricing();
unreachableCatalog.failure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'catalog yok');
const callWithoutCatalog = useOrderGrpcServer({ catalog: unreachableCatalog });

describe('CreateDraftOrder', () => {
  it('onekli orderId ve DRAFT durumu doner', async () => {
    const { error, response } = await call(
      orderV1.OrderServiceService.createDraftOrder,
      draftRequest,
    );

    expect(error).toBeUndefined();
    expect(response?.orderId).toMatch(/^ord_[0-9a-f]{32}$/);
    expect(response?.status).toBe(orderV1.OrderStatus.ORDER_STATUS_DRAFT);
    // Stok taslakta kilitlenir (T11.2): bitis ani istemcinin geri sayimidir.
    expect(response?.reservationExpiresAt).toBeInstanceOf(Date);
  });

  it('bos sepeti INVALID_ARGUMENT ile reddeder', async () => {
    const { error } = await call(orderV1.OrderServiceService.createDraftOrder, {
      ...draftRequest,
      lines: [],
    });

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(appErrorOf(error)?.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('market_id zorunlu ve mkt_ bicimli: eski ds_ kimligi reddedilir (ADR-15)', async () => {
    const { error } = await call(orderV1.OrderServiceService.createDraftOrder, {
      ...draftRequest,
      darkStoreId: 'ds_kadikoy',
      marketId: '',
    });

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(appErrorOf(error)?.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('idempotency anahtari olmadan reddeder (ADR-08)', async () => {
    const { error } = await call(orderV1.OrderServiceService.createDraftOrder, {
      ...draftRequest,
      idempotencyKey: '',
    });

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
  });
});

describe('CreateDraftOrder: sunucu tarafi fiyat dogrulamasi (T7.2)', () => {
  it('istemcinin gordugu toplam tutmazsa ABORTED + PRICE_CHANGED; ayrintida yeni toplam', async () => {
    const { error, response } = await call(orderV1.OrderServiceService.createDraftOrder, {
      ...draftRequest,
      expectedTotal: { amountMinor: 1, currency: 'TRY' },
    });

    expect(response).toBeUndefined();
    expect(error?.code).toBe(GRPC_STATUS.ABORTED);
    expect(appErrorOf(error)).toMatchObject({
      code: ERROR_CODES.PRICE_CHANGED,
      details: { totalMinor: DRAFT_TOTAL_MINOR },
    });
  });

  it('markette satilmayan urun: INVALID_ARGUMENT + hangi urunler', async () => {
    const { error } = await call(orderV1.OrderServiceService.createDraftOrder, {
      ...draftRequest,
      lines: [{ productId: 'prd_yok', sku: 'YOK-1', quantity: 1 }],
    });

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(appErrorOf(error)).toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
      details: { unavailableProductIds: ['prd_yok'] },
    });
  });

  it("catalog'a ulasilamazsa UNAVAILABLE + SERVICE_UNAVAILABLE", async () => {
    const { error } = await callWithoutCatalog(
      orderV1.OrderServiceService.createDraftOrder,
      draftRequest,
    );

    expect(error?.code).toBe(GRPC_STATUS.UNAVAILABLE);
    expect(appErrorOf(error)?.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
  });
});
