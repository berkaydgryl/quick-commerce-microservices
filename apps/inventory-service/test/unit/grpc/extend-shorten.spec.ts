/**
 * ExtendReservation ve ShortenReservation (T11.3, B21) gercek gRPC sunucusu
 * uzerinden, bellekteki demo stogu, sabit saat ve hak sayisi 2 ile. Deponun
 * kurallari sozlesme testinde, Redis ve Mongo'daki karsiligi test/integration/'da.
 */

import { ERROR_CODES, fixedClock, GRPC_STATUS } from '@getir/core';
import { inventoryV1 } from '@getir/proto';
import { appErrorOf } from '@getir/service-kit/testing';
import { describe, expect, it } from 'vitest';

import { useInventoryGrpcServer } from '../../support/inventory-grpc-harness.js';

const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);
const MARKET = 'mkt_migros-jet-moda';
const TTL_SECONDS = 600;
const service = inventoryV1.InventoryServiceService;
const call = useInventoryGrpcServer(() => ({ clock: fixedClock(NOW), maxExtensions: 2 }));

const orderId = (n: number) => `ord_${n.toString(16).padStart(32, '0')}`;
const userId = (n: number) => `usr_${n.toString(16).padStart(32, '0')}`;
const at = (offsetSeconds: number) => new Date(NOW + offsetSeconds * 1_000);

const reserve = (order: number) =>
  call(
    service.reserve,
    inventoryV1.ReserveRequest.fromPartial({
      orderId: orderId(order),
      marketId: MARKET,
      userId: userId(order),
      items: [{ sku: 'SUT-1L', quantity: 1 }],
      ttlSeconds: TTL_SECONDS,
    }),
  );

const extend = (order: number, override: Partial<inventoryV1.ExtendReservationRequest> = {}) =>
  call(
    service.extendReservation,
    inventoryV1.ExtendReservationRequest.fromPartial({
      orderId: orderId(order),
      marketId: MARKET,
      additionalSeconds: 60,
      ...override,
    }),
  );

const shorten = (order: number, override: Partial<inventoryV1.ShortenReservationRequest> = {}) =>
  call(
    service.shortenReservation,
    inventoryV1.ShortenReservationRequest.fromPartial({
      orderId: orderId(order),
      marketId: MARKET,
      maxRemainingSeconds: 120,
      ...override,
    }),
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

describe('ExtendReservation (T11.3)', () => {
  it('her uzatma bitisi ileri alir ve sayar; hak (2) bitince sure AYNI, alreadyExtended', async () => {
    await reserve(1);

    expect((await extend(1)).response).toEqual({
      expiresAt: at(TTL_SECONDS + 60),
      alreadyExtended: false,
      extensionCount: 1,
    });
    expect((await extend(1)).response).toEqual({
      expiresAt: at(TTL_SECONDS + 120),
      alreadyExtended: false,
      extensionCount: 2,
    });
    expect((await extend(1)).response).toEqual({
      expiresAt: at(TTL_SECONDS + 120),
      alreadyExtended: true,
      extensionCount: 2,
    });
  });

  it('aktif rezervasyon yoksa FAILED_PRECONDITION / RESERVATION_EXPIRED: birakilmis ve hic olmamis', async () => {
    await reserve(2);
    await release(2);

    for (const order of [2, 9]) {
      const { error } = await extend(order);
      expect(error?.code).toBe(GRPC_STATUS.FAILED_PRECONDITION);
      expect(appErrorOf(error)).toMatchObject({
        code: ERROR_CODES.RESERVATION_EXPIRED,
        details: { orderId: orderId(order), marketId: MARKET },
      });
    }
  });

  it.each([
    ['siparis bicimsiz', { orderId: 'ord_1' }],
    ['market yok', { marketId: '' }],
    ['sure 0', { additionalSeconds: 0 }],
    ['sure negatif', { additionalSeconds: -60 }],
    ['sure 300 sn ustu', { additionalSeconds: 301 }],
  ])('%s: INVALID_ARGUMENT / VALIDATION_FAILED', async (_name, override) => {
    const { error } = await extend(1, override);

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(appErrorOf(error)?.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });
});

describe('ShortenReservation (T11.3)', () => {
  it('kalan sureyi sinira indirir; ikinci kez shortened=false; ASLA uzatmaz', async () => {
    await reserve(3);

    expect((await shorten(3)).response).toEqual({ expiresAt: at(120), shortened: true });
    expect((await shorten(3, { maxRemainingSeconds: 300 })).response).toEqual({
      expiresAt: at(120),
      shortened: false,
    });
  });

  it('aktif rezervasyon yoksa FAILED_PRECONDITION / RESERVATION_EXPIRED', async () => {
    const { error } = await shorten(9);

    expect(error?.code).toBe(GRPC_STATUS.FAILED_PRECONDITION);
    expect(appErrorOf(error)?.code).toBe(ERROR_CODES.RESERVATION_EXPIRED);
  });

  it.each([
    ['siparis bicimsiz', { orderId: 'ord_1' }],
    ['sure 30 sn alti (birakma degil kisaltma)', { maxRemainingSeconds: 29 }],
    ['sure 900 sn ustu', { maxRemainingSeconds: 901 }],
  ])('%s: INVALID_ARGUMENT / VALIDATION_FAILED', async (_name, override) => {
    const { error } = await shorten(3, override);

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(appErrorOf(error)?.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });
});
