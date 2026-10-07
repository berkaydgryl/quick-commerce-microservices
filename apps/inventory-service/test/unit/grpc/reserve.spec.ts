/**
 * Reserve (T10.1) gercek gRPC sunucusu uzerinden, bellekteki demo stogu ve
 * sabit saatle. Deponun kurallari sozlesme testinde, Redis'teki karsiligi
 * test/integration/reservation.spec.ts'te.
 */

import { ERROR_CODES, fixedClock, GRPC_STATUS } from '@getir/core';
import { inventoryV1 } from '@getir/proto';
import { appErrorOf } from '@getir/service-kit/testing';
import { describe, expect, it } from 'vitest';

import { useInventoryGrpcServer } from '../../support/inventory-grpc-harness.js';

const NOW = Date.UTC(2026, 8, 30, 12, 0, 0);
const MARKET = 'mkt_migros-jet-moda';
const service = inventoryV1.InventoryServiceService;
const call = useInventoryGrpcServer(() => ({ clock: fixedClock(NOW) }));

const orderId = (n: number) => `ord_${n.toString(16).padStart(32, '0')}`;
const userId = (n: number) => `usr_${n.toString(16).padStart(32, '0')}`;

const reserve = (
  order: number,
  user: number,
  items: readonly { sku: string; quantity: number }[],
  ttlSeconds = 600,
) =>
  call(
    service.reserve,
    inventoryV1.ReserveRequest.fromPartial({
      orderId: orderId(order),
      marketId: MARKET,
      userId: userId(user),
      items: [...items],
      ttlSeconds,
    }),
  );

const available = async (skus: readonly string[]) =>
  (await call(service.checkAvailability, { darkStoreId: '', marketId: MARKET, skus: [...skus] }))
    .response?.items;

describe('Reserve (T10.1)', () => {
  it('rezerve eder: bitis = simdi + sure; dusum musaitlikte hemen gorunur', async () => {
    const { error, response } = await reserve(1, 1, [{ sku: 'SUT-1L', quantity: 2 }], 120);

    expect(error).toBeUndefined();
    expect(response).toEqual({ expiresAt: new Date(NOW + 120_000), alreadyReserved: false });
    expect(await available(['SUT-1L'])).toEqual([{ sku: 'SUT-1L', availableQuantity: 22 }]);
  });

  it('ayni siparis tekrar: alreadyReserved, ayni bitis; stok ikinci kez dusmez', async () => {
    const again = await reserve(1, 1, [{ sku: 'SUT-1L', quantity: 2 }], 120);

    expect(again.response).toEqual({ expiresAt: new Date(NOW + 120_000), alreadyReserved: true });
    expect(await available(['SUT-1L'])).toEqual([{ sku: 'SUT-1L', availableQuantity: 22 }]);
  });

  it('kismi rezervasyon yok: yetmeyen kalem FAILED_PRECONDITION / STOCK_INSUFFICIENT + ayrinti', async () => {
    const { error } = await reserve(2, 2, [
      { sku: 'PEYNIR-500', quantity: 1 },
      { sku: 'CIKOLATA-80', quantity: 2 },
    ]);

    expect(error?.code).toBe(GRPC_STATUS.FAILED_PRECONDITION);
    expect(appErrorOf(error)).toMatchObject({
      code: ERROR_CODES.STOCK_INSUFFICIENT,
      details: { sku: 'CIKOLATA-80', requested: 2, available: 1 },
    });
    expect(await available(['CIKOLATA-80'])).toEqual([
      { sku: 'CIKOLATA-80', availableQuantity: 1 },
    ]);
  });

  it('bu markette sayaci olmayan SKU yetersiz: mevcut 0, counterMissing', async () => {
    const { error } = await reserve(3, 3, [{ sku: 'YOK-1', quantity: 1 }]);

    expect(appErrorOf(error)).toMatchObject({
      code: ERROR_CODES.STOCK_INSUFFICIENT,
      details: { sku: 'YOK-1', requested: 1, available: 0, counterMissing: true },
    });
  });

  it('kullanicinin baska aktif rezervasyonu: ALREADY_EXISTS / RESERVATION_ACTIVE + o siparis', async () => {
    const { error } = await reserve(4, 1, [{ sku: 'KOLA-1L', quantity: 1 }]);

    expect(error?.code).toBe(GRPC_STATUS.ALREADY_EXISTS);
    expect(appErrorOf(error)).toMatchObject({
      code: ERROR_CODES.RESERVATION_ACTIVE,
      // Kalan omur (T15.3): saat sabit; 1. siparisin kilidi ilk testte 120 sn ile acildi.
      details: { activeOrderId: orderId(1), activeExpiresInMs: 120_000 },
    });
  });

  it('gecersiz istek INVALID_ARGUMENT / VALIDATION_FAILED; alan adiyla', async () => {
    const { error } = await call(
      service.reserve,
      inventoryV1.ReserveRequest.fromPartial({ orderId: 'ord_1', marketId: MARKET }),
    );

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(appErrorOf(error)).toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
    expect(Object.keys(appErrorOf(error)?.details ?? {})).toEqual(
      expect.arrayContaining(['orderId', 'userId', 'items', 'ttlSeconds']),
    );
  });
});
