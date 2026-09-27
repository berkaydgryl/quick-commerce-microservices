/**
 * CreateDraftOrder kapi testi: gercek gRPC sunucusu + gercek istemci.
 * T3.2'nin "bitti sayilir" olcutunun (grpcurl ile orderId doner) otomatik karsiligi.
 */

import { ERROR_CODES, GRPC_STATUS } from '@getir/core';
import { orderV1 } from '@getir/proto';
import { describe, expect, it } from 'vitest';

import { appErrorOf } from '../../support/grpc-error.js';
import { draftRequest } from '../../support/order-fixtures.js';
import { useOrderGrpcServer } from '../../support/order-grpc-harness.js';

const call = useOrderGrpcServer();

describe('CreateDraftOrder', () => {
  it('onekli orderId ve DRAFT durumu doner', async () => {
    const { error, response } = await call(
      orderV1.OrderServiceService.createDraftOrder,
      draftRequest,
    );

    expect(error).toBeUndefined();
    expect(response?.orderId).toMatch(/^ord_[0-9a-f]{32}$/);
    expect(response?.status).toBe(orderV1.OrderStatus.ORDER_STATUS_DRAFT);
    // Stok henuz kilitlenmiyor: rezervasyon bitis ani BOS olmali.
    expect(response?.reservationExpiresAt).toBeUndefined();
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
