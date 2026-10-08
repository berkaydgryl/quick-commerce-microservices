/**
 * GetOrder kapi testi: siparis ayrintisi, sahiplik ve odeme bekleyen siparisin
 * 3DS durumu (#163 B1; kurallarin tamami get-order-three-ds.spec.ts'te).
 */

import { GRPC_STATUS } from '@getir/core';
import { commonV1, orderV1 } from '@getir/proto';
import { describe, expect, it } from 'vitest';

import { FakePayments, TEST_CARD } from '../../support/fake-payments.js';
import {
  cancelOrderRequest,
  createOrderRequest,
  DRAFT_TOTAL_MINOR,
  draftRequest,
} from '../../support/order-fixtures.js';
import { newDraftId, useOrderGrpcServer } from '../../support/order-grpc-harness.js';

const payments = new FakePayments();
const call = useOrderGrpcServer({ payments });

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
    // Kalemler ve tutar taslakta catalog fiyatiyla dondurulur (T7.2).
    expect(response?.order?.items).toEqual([
      {
        productId: 'prd_01',
        sku: 'SUT-1L',
        name: 'Süt 1 L',
        quantity: { value: 2, unit: commonV1.Unit.UNIT_LITER },
        unitPrice: { amountMinor: 3_250, currency: 'TRY' },
        lineTotal: { amountMinor: 6_500, currency: 'TRY' },
      },
    ]);
    expect(response?.order).toMatchObject({
      subtotal: { amountMinor: 6_500, currency: 'TRY' },
      deliveryFee: { amountMinor: 1_490, currency: 'TRY' },
      discount: { amountMinor: 0, currency: 'TRY' },
      total: { amountMinor: DRAFT_TOTAL_MINOR, currency: 'TRY' },
    });
  });

  it('stok kilidinin bitis ani yalnizca kilit canliyken doner; iptalden sonra BOS (T11.2)', async () => {
    const draft = { ...draftRequest, userId: 'usr_kilit' };
    const orderId = await newDraftId(call, draft);
    const read = async () =>
      (await call(orderV1.OrderServiceService.getOrder, { orderId, userId: 'usr_kilit' })).response
        ?.order;

    expect((await read())?.reservationExpiresAt).toBeInstanceOf(Date);

    await call(
      orderV1.OrderServiceService.cancelOrder,
      cancelOrderRequest(orderId, { userId: 'usr_kilit' }),
    );

    expect((await read())?.reservationExpiresAt).toBeUndefined();
  });

  it('baskasinin siparisi NOT_FOUND (PERMISSION_DENIED degil)', async () => {
    const orderId = await newDraftId(call);

    const { error } = await call(orderV1.OrderServiceService.getOrder, {
      orderId,
      userId: 'usr_2',
    });

    expect(error?.code).toBe(GRPC_STATUS.NOT_FOUND);
  });

  it('odeme bekleyen sipariste 3DS durumu telden AYNEN gelir; taslakta alan yok ve payment a gidilmez (#163 B1)', async () => {
    const draft = { ...draftRequest, userId: 'usr_3ds' };
    const awaitingId = await newDraftId(call, draft);
    const placed = await call(
      orderV1.OrderServiceService.createOrder,
      createOrderRequest(awaitingId, { userId: 'usr_3ds', cardToken: TEST_CARD.CHALLENGE }),
    );
    expect(placed.response?.status).toBe(orderV1.OrderStatus.ORDER_STATUS_AWAITING_PAYMENT);
    const threeDs = {
      challengeId: 'tds_0009d7cd0e904b689aabcacf4458d520',
      expiresAt: new Date('2026-10-08T09:00:42.000Z'),
      attemptsLeft: 2,
    };
    payments.threeDs.set(awaitingId, { userId: 'usr_3ds', threeDs });

    const awaiting = await call(orderV1.OrderServiceService.getOrder, {
      orderId: awaitingId,
      userId: 'usr_3ds',
    });

    expect(awaiting.error).toBeUndefined();
    expect(awaiting.response?.threeDs).toEqual(threeDs);

    // Taslak baska kullanicinin: kullanici basina tek aktif rezervasyon (T11.4).
    const draftId = await newDraftId(call, { ...draftRequest, userId: 'usr_3ds_taslak' });
    payments.threeDs.set(draftId, { userId: 'usr_3ds_taslak', threeDs });
    const lookups = payments.threeDsLookups.length;
    const { response } = await call(orderV1.OrderServiceService.getOrder, {
      orderId: draftId,
      userId: 'usr_3ds_taslak',
    });

    expect(response?.order?.status).toBe(orderV1.OrderStatus.ORDER_STATUS_DRAFT);
    expect(response?.threeDs).toBeUndefined();
    expect(payments.threeDsLookups).toHaveLength(lookups);
  });
});
