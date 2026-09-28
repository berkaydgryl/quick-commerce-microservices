/**
 * ListMyOrders kapi testi: jetonla sayfalama, varsayilan sayfa, bos gecmis.
 */

import { ERROR_CODES, GRPC_STATUS } from '@getir/core';
import { orderV1 } from '@getir/proto';
import { beforeAll, describe, expect, it } from 'vitest';

import { appErrorOf } from '@getir/service-kit/testing';
import { draftRequest } from '../../support/order-fixtures.js';
import { newDraftId, useOrderGrpcServer } from '../../support/order-grpc-harness.js';

const call = useOrderGrpcServer();

describe('ListMyOrders', () => {
  // Dosyanin sunucusu kendi bellek deposunu kullanir; kullanicinin 3 siparisi olur.
  const userId = 'usr_history';

  beforeAll(async () => {
    for (let index = 0; index < 3; index += 1) {
      await newDraftId(call, { ...draftRequest, userId });
    }
  });

  it('jetonla sayfalar: kayit kaybolmaz, tekrar etmez, son sayfada jeton bos', async () => {
    const first = await call(orderV1.OrderServiceService.listMyOrders, {
      userId,
      page: { pageSize: 2, pageToken: '' },
    });
    const second = await call(orderV1.OrderServiceService.listMyOrders, {
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
    const { error, response } = await call(orderV1.OrderServiceService.listMyOrders, { userId });

    expect(error).toBeUndefined();
    expect(response?.orders).toHaveLength(3);
  });

  it('siparisi olmayan kullanici: bos liste, hata degil', async () => {
    const { error, response } = await call(orderV1.OrderServiceService.listMyOrders, {
      userId: 'usr_yeni',
    });

    expect(error).toBeUndefined();
    expect(response?.orders).toEqual([]);
    expect(response?.page?.nextPageToken).toBe('');
  });

  it('bu sunucunun uretmedigi jeton INVALID_ARGUMENT', async () => {
    const { error } = await call(orderV1.OrderServiceService.listMyOrders, {
      userId,
      page: { pageSize: 2, pageToken: 'uydurma-jeton' },
    });

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(appErrorOf(error)?.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });
});
