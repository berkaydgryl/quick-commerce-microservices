/**
 * CancelOrder kapi testi: iptal, tekrar iptal, gerekce bicimi ve sahiplik.
 */

import { ERROR_CODES, GRPC_STATUS } from '@getir/core';
import { orderV1 } from '@getir/proto';
import { describe, expect, it } from 'vitest';

import { appErrorOf } from '../../support/grpc-error.js';
import { newDraftId, useOrderGrpcServer } from '../../support/order-grpc-harness.js';

const call = useOrderGrpcServer();

describe('CancelOrder', () => {
  it('taslagi iptal eder, CANCELLED doner', async () => {
    const orderId = await newDraftId(call);

    const { error, response } = await call(orderV1.OrderServiceService.cancelOrder, {
      orderId,
      userId: 'usr_1',
      reason: 'CHANGED_MIND',
    });

    expect(error).toBeUndefined();
    expect(response?.status).toBe(orderV1.OrderStatus.ORDER_STATUS_CANCELLED);
  });

  it('iptal edilmis siparisi ikinci kez iptal: FAILED_PRECONDITION', async () => {
    const orderId = await newDraftId(call);
    await call(orderV1.OrderServiceService.cancelOrder, { orderId, userId: 'usr_1', reason: '' });

    const { error } = await call(orderV1.OrderServiceService.cancelOrder, {
      orderId,
      userId: 'usr_1',
      reason: '',
    });

    expect(error?.code).toBe(GRPC_STATUS.FAILED_PRECONDITION);
    expect(appErrorOf(error)?.code).toBe(ERROR_CODES.ORDER_STATE_INVALID);
  });

  it('gerekce anahtar bicimi disindaysa INVALID_ARGUMENT', async () => {
    const orderId = await newDraftId(call);

    const { error } = await call(orderV1.OrderServiceService.cancelOrder, {
      orderId,
      userId: 'usr_1',
      reason: 'fikrimi degistirdim',
    });

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
  });

  it('baskasinin siparisi NOT_FOUND', async () => {
    const orderId = await newDraftId(call);

    const { error } = await call(orderV1.OrderServiceService.cancelOrder, {
      orderId,
      userId: 'usr_2',
      reason: '',
    });

    expect(error?.code).toBe(GRPC_STATUS.NOT_FOUND);
  });
});
