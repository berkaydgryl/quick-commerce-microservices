/**
 * CancelOrder kapi testi: iptal, tekrar iptal, gerekce bicimi, sahiplik ve
 * parasi alinmis siparisin iptal edilmemesi (T11.2 PR 2).
 */

import { AppError, ERROR_CODES, GRPC_STATUS } from '@getir/core';
import { orderV1 } from '@getir/proto';
import { describe, expect, it } from 'vitest';

import { appErrorOf } from '@getir/service-kit/testing';
import { FakeStockReservations } from '../../support/fake-stock-reservations.js';
import {
  cancelOrderRequest,
  createOrderRequest,
  draftRequest,
} from '../../support/order-fixtures.js';
import { newDraftId, useOrderGrpcServer } from '../../support/order-grpc-harness.js';

const call = useOrderGrpcServer();

// Ayri sunucu: kesinlestirmeye ulasilamayan inventory. Kart cekildikten sonra
// Commit duser, siparis parasi alinmis halde AWAITING_PAYMENT kalir.
const unreachableCommit = new FakeStockReservations();
unreachableCommit.commitFailure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'inventory yok');
const callWithoutCommit = useOrderGrpcServer({ stock: unreachableCommit });

describe('CancelOrder', () => {
  it('taslagi iptal eder, CANCELLED doner', async () => {
    const orderId = await newDraftId(call);

    const { error, response } = await call(
      orderV1.OrderServiceService.cancelOrder,
      cancelOrderRequest(orderId, { reason: 'CHANGED_MIND' }),
    );

    expect(error).toBeUndefined();
    expect(response?.status).toBe(orderV1.OrderStatus.ORDER_STATUS_CANCELLED);
  });

  it('iptal edilmis siparisi ikinci kez iptal: FAILED_PRECONDITION', async () => {
    const orderId = await newDraftId(call);
    await call(orderV1.OrderServiceService.cancelOrder, cancelOrderRequest(orderId));

    const { error } = await call(
      orderV1.OrderServiceService.cancelOrder,
      cancelOrderRequest(orderId),
    );

    expect(error?.code).toBe(GRPC_STATUS.FAILED_PRECONDITION);
    expect(appErrorOf(error)?.code).toBe(ERROR_CODES.ORDER_STATE_INVALID);
  });

  it('gerekce anahtar bicimi disindaysa INVALID_ARGUMENT', async () => {
    const orderId = await newDraftId(call);

    const { error } = await call(
      orderV1.OrderServiceService.cancelOrder,
      cancelOrderRequest(orderId, { reason: 'fikrimi degistirdim' }),
    );

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
  });

  it.each(['STOCK_INSUFFICIENT', 'RESERVATION_EXPIRED', 'CART_REPLACED'])(
    'sistemin iptal notu (%s) kullanici gerekcesi olamaz: risk gecmisinden iptal gizlenmesin',
    async (reason) => {
      const orderId = await newDraftId(call);

      const { error } = await call(
        orderV1.OrderServiceService.cancelOrder,
        cancelOrderRequest(orderId, { reason }),
      );

      expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
      expect(Object.keys(appErrorOf(error)?.details as object)).toEqual(['reason']);
    },
  );

  it('baskasinin siparisi NOT_FOUND', async () => {
    const orderId = await newDraftId(call);

    const { error } = await call(
      orderV1.OrderServiceService.cancelOrder,
      cancelOrderRequest(orderId, { userId: 'usr_2' }),
    );

    expect(error?.code).toBe(GRPC_STATUS.NOT_FOUND);
  });

  it('idempotency anahtari olmadan reddeder ve siparis DEGISMEZ (ADR-08)', async () => {
    const orderId = await newDraftId(call);

    const { error } = await call(
      orderV1.OrderServiceService.cancelOrder,
      cancelOrderRequest(orderId, { idempotencyKey: '' }),
    );
    const { response } = await call(orderV1.OrderServiceService.getOrder, {
      orderId,
      userId: 'usr_1',
    });

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(appErrorOf(error)?.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(response?.order?.status).toBe(orderV1.OrderStatus.ORDER_STATUS_DRAFT);
  });
});

describe('CancelOrder - parasi alinmis siparis (T11.2 PR 2)', () => {
  it('odeme bekleyen ama parasi alinmis siparis iptal EDILMEZ: ABORTED + REQUEST_IN_PROGRESS', async () => {
    const orderId = await newDraftId(callWithoutCommit, { ...draftRequest, userId: 'usr_cekildi' });
    const placed = await callWithoutCommit(
      orderV1.OrderServiceService.createOrder,
      createOrderRequest(orderId, { userId: 'usr_cekildi' }),
    );
    expect(appErrorOf(placed.error)?.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);

    const { error } = await callWithoutCommit(
      orderV1.OrderServiceService.cancelOrder,
      cancelOrderRequest(orderId, { userId: 'usr_cekildi' }),
    );

    expect(error?.code).toBe(GRPC_STATUS.ABORTED);
    expect(appErrorOf(error)).toEqual({
      code: ERROR_CODES.REQUEST_IN_PROGRESS,
      details: { orderId, paymentStatus: 'SUCCEEDED' },
    });
    const { response } = await callWithoutCommit(orderV1.OrderServiceService.getOrder, {
      orderId,
      userId: 'usr_cekildi',
    });
    expect(response?.order?.status).toBe(orderV1.OrderStatus.ORDER_STATUS_AWAITING_PAYMENT);
  });
});
