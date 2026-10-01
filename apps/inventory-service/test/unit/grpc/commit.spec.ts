/**
 * Commit (T10.2 PR 2) gercek gRPC sunucusu uzerinden, bellekteki demo stogu ve
 * sabit saatle. Deponun kurallari sozlesme testinde, Redis ve Mongo'daki
 * karsiligi test/integration/'da.
 */

import { ERROR_CODES, fixedClock, GRPC_STATUS } from '@getir/core';
import { inventoryV1 } from '@getir/proto';
import { appErrorOf } from '@getir/service-kit/testing';
import { describe, expect, it } from 'vitest';

import { useInventoryGrpcServer } from '../../support/inventory-grpc-harness.js';

const NOW = Date.UTC(2026, 9, 1, 12, 0, 0);
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

const commit = (order: number, marketId = MARKET) =>
  call(
    service.commit,
    inventoryV1.CommitRequest.fromPartial({ orderId: orderId(order), marketId }),
  );

const release = (order: number) =>
  call(
    service.release,
    inventoryV1.ReleaseRequest.fromPartial({
      orderId: orderId(order),
      marketId: MARKET,
      reason: 'user_cancelled',
    }),
  );

const available = async (skus: readonly string[]) =>
  (await call(service.checkAvailability, { darkStoreId: '', marketId: MARKET, skus: [...skus] }))
    .response?.items;

describe('Commit (T10.2 PR 2)', () => {
  it('onaylar: APPLIED; musaitlik DEGISMEZ (adet rezervasyonda dusmustu)', async () => {
    await reserve(1, [{ sku: 'SUT-1L', quantity: 2 }]);

    const { error, response } = await commit(1);

    expect(error).toBeUndefined();
    expect(response).toEqual({ outcome: RESERVATION_OUTCOME_APPLIED });
    expect(await available(['SUT-1L'])).toEqual([{ sku: 'SUT-1L', availableQuantity: 22 }]);
  });

  it('ayni onay tekrar: ALREADY_APPLIED; onaylanan birakilamaz: NOT_FOUND, stok geri gelmez', async () => {
    expect((await commit(1)).response).toEqual({ outcome: RESERVATION_OUTCOME_ALREADY_APPLIED });
    expect((await release(1)).response).toEqual({ outcome: RESERVATION_OUTCOME_NOT_FOUND });
    expect(await available(['SUT-1L'])).toEqual([{ sku: 'SUT-1L', availableQuantity: 22 }]);
  });

  it('birakilan onaylanamaz; hic olmamis ve baska market NOT_FOUND', async () => {
    await reserve(2, [{ sku: 'PEYNIR-500', quantity: 1 }]);
    await release(2);

    expect((await commit(2)).response).toEqual({ outcome: RESERVATION_OUTCOME_NOT_FOUND });
    expect((await commit(9)).response).toEqual({ outcome: RESERVATION_OUTCOME_NOT_FOUND });
    await reserve(3, [{ sku: 'PEYNIR-500', quantity: 1 }]);
    expect((await commit(3, 'mkt_a101-caferaga')).response).toEqual({
      outcome: RESERVATION_OUTCOME_NOT_FOUND,
    });
  });

  it.each([
    ['siparis bicimsiz', { orderId: 'ord_1' }],
    ['market yok', { marketId: '' }],
  ])('%s: INVALID_ARGUMENT / VALIDATION_FAILED', async (_name, override) => {
    const { error } = await call(
      service.commit,
      inventoryV1.CommitRequest.fromPartial({ orderId: orderId(1), marketId: MARKET, ...override }),
    );

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(appErrorOf(error)?.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });
});
