/**
 * CheckAvailability gercek gRPC sunucusu uzerinden (bellekteki demo stogu).
 * Use-case kurallari test/unit/check-availability.spec.ts'te.
 */

import { ERROR_CODES, GRPC_STATUS } from '@getir/core';
import { inventoryV1 } from '@getir/proto';
import { appErrorOf } from '@getir/service-kit/testing';
import { describe, expect, it } from 'vitest';

import { MAX_AVAILABILITY_SKUS } from '../../../src/config/constants.js';
import { useInventoryGrpcServer } from '../../support/inventory-grpc-harness.js';

const call = useInventoryGrpcServer();
const service = inventoryV1.InventoryServiceService;

describe('CheckAvailability (T9.1, B27)', () => {
  it('toplu: adetler ve kaydi olmayan SKU lar tek cevapta', async () => {
    const { error, response } = await call(service.checkAvailability, {
      darkStoreId: '',
      marketId: 'mkt_migros-jet-moda',
      skus: ['CIKOLATA-80', 'KOLA-1L', 'YOK-1'],
    });

    expect(error).toBeUndefined();
    expect(response?.items).toEqual([
      { sku: 'CIKOLATA-80', availableQuantity: 1 },
      { sku: 'KOLA-1L', availableQuantity: 0 },
    ]);
    expect(response?.unknownSkus).toEqual(['YOK-1']);
  });

  it(`${MAX_AVAILABILITY_SKUS} den fazla SKU INVALID_ARGUMENT / VALIDATION_FAILED`, async () => {
    const { error } = await call(service.checkAvailability, {
      darkStoreId: '',
      marketId: 'mkt_migros-jet-moda',
      skus: Array.from({ length: MAX_AVAILABILITY_SKUS + 1 }, (_, index) => `SKU-${index}`),
    });

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(appErrorOf(error)?.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('market zorunlu', async () => {
    const { error } = await call(service.checkAvailability, {
      darkStoreId: '',
      marketId: '',
      skus: [],
    });

    expect(appErrorOf(error)?.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });
});

describe('rezervasyon RPC leri henuz yok (T10)', () => {
  // Her cagri kendi mesajiyla (bos istek): yanlis mesaj istemci tarafinda
  // kodlanamaz ve INTERNAL doner, sinanan sey sunucu olmazdi.
  const cases = [
    ['Reserve', () => call(service.reserve, inventoryV1.ReserveRequest.fromPartial({}))],
    ['Commit', () => call(service.commit, inventoryV1.CommitRequest.fromPartial({}))],
    ['Release', () => call(service.release, inventoryV1.ReleaseRequest.fromPartial({}))],
    [
      'ExtendReservation',
      () => call(service.extendReservation, inventoryV1.ExtendReservationRequest.fromPartial({})),
    ],
    [
      'GetReservation',
      () => call(service.getReservation, inventoryV1.GetReservationRequest.fromPartial({})),
    ],
  ] as const;

  it.each(cases)('%s UNIMPLEMENTED / NOT_IMPLEMENTED', async (_name, invoke) => {
    const { error } = await invoke();

    expect(error?.code).toBe(GRPC_STATUS.UNIMPLEMENTED);
    expect(appErrorOf(error)?.code).toBe(ERROR_CODES.NOT_IMPLEMENTED);
  });
});
