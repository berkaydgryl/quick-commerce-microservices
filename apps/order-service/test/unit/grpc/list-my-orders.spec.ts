/**
 * ListMyOrders kapi testi: jetonla sayfalama, varsayilan sayfa, bos gecmis;
 * yalnizca gecmiste gorunen siparisler (#101).
 */

import { ERROR_CODES, GRPC_STATUS } from '@getir/core';
import { orderV1 } from '@getir/proto';
import { beforeAll, describe, expect, it } from 'vitest';

import { appErrorOf } from '@getir/service-kit/testing';
import {
  cancelOrderRequest,
  createOrderRequest,
  draftRequest,
} from '../../support/order-fixtures.js';
import { newDraftId, useOrderGrpcServer } from '../../support/order-grpc-harness.js';

const call = useOrderGrpcServer();
const Orders = orderV1.OrderServiceService;

/** Taslak acar ve kartla oder (sahte risk LOW, onaylanan kart): PAID siparisin kimligi. */
async function placePaid(userId: string): Promise<string> {
  const orderId = await newDraftId(call, { ...draftRequest, userId });
  const { response } = await call(Orders.createOrder, createOrderRequest(orderId, { userId }));
  expect(response?.status).toBe(orderV1.OrderStatus.ORDER_STATUS_PAID);
  return orderId;
}

describe('ListMyOrders', () => {
  // Dosyanin sunucusu kendi bellek deposunu kullanir; kullanicinin 3 odenmis siparisi olur.
  const userId = 'usr_history';

  beforeAll(async () => {
    for (let index = 0; index < 3; index += 1) {
      await placePaid(userId);
    }
  });

  it('jetonla sayfalar: kayit kaybolmaz, tekrar etmez, son sayfada jeton bos', async () => {
    const first = await call(Orders.listMyOrders, {
      userId,
      page: { pageSize: 2, pageToken: '' },
    });
    const second = await call(Orders.listMyOrders, {
      userId,
      page: { pageSize: 2, pageToken: first.response?.page?.nextPageToken ?? '' },
    });

    expect(first.response?.orders).toHaveLength(2);
    expect(first.response?.page?.nextPageToken).not.toBe('');
    expect(second.response?.orders).toHaveLength(1);
    expect(second.response?.page?.nextPageToken).toBe('');

    const orders = [...(first.response?.orders ?? []), ...(second.response?.orders ?? [])];
    expect(new Set(orders.map((order) => order.id)).size).toBe(3);
    expect(orders.every((order) => order.userId === userId)).toBe(true);
  });

  it('page gonderilmezse varsayilan boyutla ilk sayfa', async () => {
    const { error, response } = await call(Orders.listMyOrders, { userId });

    expect(error).toBeUndefined();
    expect(response?.orders).toHaveLength(3);
  });

  it('sepet taslagi ve odenmeden iptal edilen siparis listede YOK (#101)', async () => {
    const shopper = 'usr_sepetli';
    const paidId = await placePaid(shopper);
    const released = await newDraftId(call, { ...draftRequest, userId: shopper });
    await call(Orders.cancelOrder, cancelOrderRequest(released, { userId: shopper }));
    await newDraftId(call, { ...draftRequest, userId: shopper });

    const { error, response } = await call(Orders.listMyOrders, { userId: shopper });

    expect(error).toBeUndefined();
    expect(response?.orders.map((order) => order.id)).toEqual([paidId]);
    expect(response?.page?.nextPageToken).toBe('');
  });

  it('siparisi olmayan kullanici: bos liste, hata degil', async () => {
    const { error, response } = await call(Orders.listMyOrders, {
      userId: 'usr_yeni',
    });

    expect(error).toBeUndefined();
    expect(response?.orders).toEqual([]);
    expect(response?.page?.nextPageToken).toBe('');
  });

  it('bu sunucunun uretmedigi jeton INVALID_ARGUMENT', async () => {
    const { error } = await call(Orders.listMyOrders, {
      userId,
      page: { pageSize: 2, pageToken: 'uydurma-jeton' },
    });

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(appErrorOf(error)?.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });
});
