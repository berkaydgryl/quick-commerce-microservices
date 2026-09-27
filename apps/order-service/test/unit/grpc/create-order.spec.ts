/**
 * CreateOrder kapi testi: taslaktan odeme bekleyen siparise gecis.
 */

import { ERROR_CODES, GRPC_STATUS } from '@getir/core';
import { orderV1 } from '@getir/proto';
import { describe, expect, it } from 'vitest';

import { appErrorOf } from '../../support/grpc-error.js';
import { createOrderRequest } from '../../support/order-fixtures.js';
import { newDraftId, useOrderGrpcServer } from '../../support/order-grpc-harness.js';

const call = useOrderGrpcServer();

describe('CreateOrder', () => {
  it('taslagi odeme bekler duruma gecirir', async () => {
    const orderId = await newDraftId(call);

    const { error, response } = await call(
      orderV1.OrderServiceService.createOrder,
      createOrderRequest(orderId),
    );

    expect(error).toBeUndefined();
    expect(response?.orderId).toBe(orderId);
    expect(response?.status).toBe(orderV1.OrderStatus.ORDER_STATUS_AWAITING_PAYMENT);
    // 3DS akisi henuz yok: challengeId bos = "dogrulama beklenmiyor".
    expect(response?.challengeId).toBe('');
  });

  it('baskasinin siparisini NOT_FOUND ile reddeder', async () => {
    const orderId = await newDraftId(call);

    const { error } = await call(
      orderV1.OrderServiceService.createOrder,
      createOrderRequest(orderId, 'usr_2'),
    );

    expect(error?.code).toBe(GRPC_STATUS.NOT_FOUND);
  });

  it('ayni siparis ikinci kez olusturulursa FAILED_PRECONDITION doner', async () => {
    const request = createOrderRequest(await newDraftId(call));

    await call(orderV1.OrderServiceService.createOrder, request);
    const { error } = await call(orderV1.OrderServiceService.createOrder, request);

    expect(error?.code).toBe(GRPC_STATUS.FAILED_PRECONDITION);
    expect(appErrorOf(error)?.code).toBe(ERROR_CODES.ORDER_STATE_INVALID);
  });
});
