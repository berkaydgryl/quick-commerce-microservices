/**
 * Release (T10.2) gercek gRPC sunucusu uzerinden, bellekteki demo stogu ve
 * sabit saatle. Deponun kurallari sozlesme testinde, Redis ve Mongo'daki
 * karsiligi test/integration/'da.
 */

import { ERROR_CODES, fixedClock, GRPC_STATUS } from '@getir/core';
import { inventoryV1 } from '@getir/proto';
import { appErrorOf } from '@getir/service-kit/testing';
import { describe, expect, it } from 'vitest';

import { useInventoryGrpcServer } from '../../support/inventory-grpc-harness.js';

const NOW = Date.UTC(2026, 9, 1, 9, 0, 0);
const MARKET = 'mkt_migros-jet-moda';
const service = inventoryV1.InventoryServiceService;
const call = useInventoryGrpcServer(() => ({ clock: fixedClock(NOW) }));

const orderId = (n: number) => `ord_${n.toString(16).padStart(32, '0')}`;
const userId = (n: number) => `usr_${n.toString(16).padStart(32, '0')}`;
const {
  RESERVATION_OUTCOME_APPLIED,
  RESERVATION_OUTCOME_ALREADY_APPLIED,
  RESERVATION_OUTCOME_NOT_FOUND,
} = inventoryV1.ReservationOutcome;

const reserve = (order: number, items: readonly { sku: string; quantity: number }[]) =>
  call(
    service.reserve,
    inventoryV1.ReserveRequest.fromPartial({
      orderId: orderId(order),
      marketId: MARKET,
      userId: userId(order),
      items: [...items],
      ttlSeconds: 600,
    }),
  );

const release = (order: number, reason = 'user_cancelled', marketId = MARKET) =>
  call(
    service.release,
    inventoryV1.ReleaseRequest.fromPartial({ orderId: orderId(order), marketId, reason }),
  );

const available = async (skus: readonly string[]) =>
  (await call(service.checkAvailability, { darkStoreId: '', marketId: MARKET, skus: [...skus] }))
    .response?.items;

describe('Release (T10.2)', () => {
  it('birakir: APPLIED; adetler musaitlige hemen doner', async () => {
    await reserve(1, [
      { sku: 'SUT-1L', quantity: 2 },
      { sku: 'PEYNIR-500', quantity: 1 },
    ]);
    expect(await available(['SUT-1L', 'PEYNIR-500'])).toEqual([
      { sku: 'SUT-1L', availableQuantity: 22 },
      { sku: 'PEYNIR-500', availableQuantity: 1 },
    ]);

    const { error, response } = await release(1);

    expect(error).toBeUndefined();
    expect(response).toEqual({ outcome: RESERVATION_OUTCOME_APPLIED });
    expect(await available(['SUT-1L', 'PEYNIR-500'])).toEqual([
      { sku: 'SUT-1L', availableQuantity: 24 },
      { sku: 'PEYNIR-500', availableQuantity: 2 },
    ]);
  });

  it('ayni birakma tekrar (farkli gerekceyle de): ALREADY_APPLIED; stok ikinci kez artmaz', async () => {
    const again = await release(1, 'payment_failed');

    expect(again.response).toEqual({ outcome: RESERVATION_OUTCOME_ALREADY_APPLIED });
    expect(await available(['SUT-1L'])).toEqual([{ sku: 'SUT-1L', availableQuantity: 24 }]);
  });

  it('hic olmamis rezervasyon ve baska market: NOT_FOUND (hata degil)', async () => {
    expect((await release(9)).response).toEqual({ outcome: RESERVATION_OUTCOME_NOT_FOUND });
    await reserve(2, [{ sku: 'SUT-1L', quantity: 1 }]);

    expect((await release(2, 'user_cancelled', 'mkt_a101-caferaga')).response).toEqual({
      outcome: RESERVATION_OUTCOME_NOT_FOUND,
    });
    expect((await release(2)).response).toEqual({ outcome: RESERVATION_OUTCOME_APPLIED });
  });

  it.each([
    ['gerekce bos', { reason: '' }],
    ['gerekce serbest metin', { reason: 'Kullanici iptal etti' }],
    ['siparis bicimsiz', { orderId: 'ord_1' }],
    ['market yok', { marketId: '' }],
  ])('%s: INVALID_ARGUMENT / VALIDATION_FAILED', async (_name, override) => {
    const { error } = await call(
      service.release,
      inventoryV1.ReleaseRequest.fromPartial({
        orderId: orderId(1),
        marketId: MARKET,
        reason: 'user_cancelled',
        ...override,
      }),
    );

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(appErrorOf(error)?.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });
});
