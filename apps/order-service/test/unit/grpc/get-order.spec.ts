/**
 * GetOrder kapi testi: siparis ayrintisi ve sahiplik.
 */

import { GRPC_STATUS } from '@getir/core';
import { orderV1 } from '@getir/proto';
import { describe, expect, it } from 'vitest';

import { newDraftId, useOrderGrpcServer } from '../../support/order-grpc-harness.js';

const call = useOrderGrpcServer();

describe('GetOrder', () => {
  it('siparisi market, durum ve zaman cizelgesiyle doner', async () => {
    const orderId = await newDraftId(call);

    const { error, response } = await call(orderV1.OrderServiceService.getOrder, {
      orderId,
      userId: 'usr_1',
    });

    expect(error).toBeUndefined();
    expect(response?.order).toMatchObject({
      id: orderId,
      userId: 'usr_1',
      marketId: 'mkt_migros-jet-moda',
      status: orderV1.OrderStatus.ORDER_STATUS_DRAFT,
      deliveryAddress: 'Kadıköy, İstanbul',
    });
    expect(response?.order?.timeline.map((entry) => entry.status)).toEqual([
      orderV1.OrderStatus.ORDER_STATUS_DRAFT,
    ]);
    expect(response?.order?.createdAt).toBeInstanceOf(Date);
    // Fiyatlar henuz hesaplanmiyor (T7.2): uydurma "0 TL" yerine alan yok.
    expect(response?.order?.total).toBeUndefined();
  });

  it('baskasinin siparisi NOT_FOUND (PERMISSION_DENIED degil)', async () => {
    const orderId = await newDraftId(call);

    const { error } = await call(orderV1.OrderServiceService.getOrder, {
      orderId,
      userId: 'usr_2',
    });

    expect(error?.code).toBe(GRPC_STATUS.NOT_FOUND);
  });
});
