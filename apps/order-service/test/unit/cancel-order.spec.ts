/**
 * Use-case: kullanici iptali (B29). Bellek deposu, sabit saat.
 */

import { AppError, ERROR_CODES, fixedClock, ORDER_STATUS } from '@getir/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { createCancelOrder } from '../../src/application/cancel-order.js';
import { createCreateDraftOrder } from '../../src/application/create-draft-order.js';
import { createCreateOrder } from '../../src/application/create-order.js';
import { transitionOrder } from '../../src/domain/order.js';
import { InMemoryOrderRepository } from '../../src/infrastructure/in-memory-order-repository.js';

const clock = fixedClock(1_760_000_000_000);
const input = {
  userId: 'usr_1',
  darkStoreId: 'ds_kadikoy',
  lines: [{ productId: 'prd_01', sku: 'SUT-1L', quantity: 1 }],
  deliveryLocation: { lat: 40.99, lng: 29.02 },
  deliveryAddress: 'Kadıköy',
};

let repository: InMemoryOrderRepository;
let draft: ReturnType<typeof createCreateDraftOrder>;
let create: ReturnType<typeof createCreateOrder>;
let cancel: ReturnType<typeof createCancelOrder>;

beforeEach(() => {
  repository = new InMemoryOrderRepository();
  draft = createCreateDraftOrder({ repository, clock });
  create = createCreateOrder({ repository, clock });
  cancel = createCancelOrder({ repository, clock });
});

describe('cancelOrder use-case', () => {
  it('DRAFT siparisi iptal eder; gerekce yoksa USER_CANCELLED yazar', async () => {
    const { id } = await draft(input);

    const order = await cancel({ orderId: id, userId: 'usr_1' });

    expect(order.status).toBe(ORDER_STATUS.CANCELLED);
    expect(order.timeline.at(-1)).toEqual({
      status: ORDER_STATUS.CANCELLED,
      at: clock.date(),
      note: 'USER_CANCELLED',
    });
    await expect(repository.findById(id)).resolves.toMatchObject({
      status: ORDER_STATUS.CANCELLED,
    });
  });

  it('odeme bekleyen siparisi verilen gerekceyle iptal eder', async () => {
    const { id } = await draft(input);
    await create({ orderId: id, userId: 'usr_1' });

    const order = await cancel({ orderId: id, userId: 'usr_1', reason: 'CHANGED_MIND' });

    expect(order.timeline.at(-1)?.note).toBe('CHANGED_MIND');
  });

  it('odenmis siparisi kullanici iptal EDEMEZ (iade sistemin telafi adimi, B20c)', async () => {
    const { id } = await draft(input);
    const awaiting = await create({ orderId: id, userId: 'usr_1' });
    await repository.save(transitionOrder(awaiting, ORDER_STATUS.PAID, clock));

    const failing = cancel({ orderId: id, userId: 'usr_1' });

    await expect(failing).rejects.toBeInstanceOf(AppError);
    await expect(failing).rejects.toMatchObject({
      code: ERROR_CODES.ORDER_STATE_INVALID,
      details: { orderId: id, status: ORDER_STATUS.PAID },
    });
    await expect(repository.findById(id)).resolves.toMatchObject({ status: ORDER_STATUS.PAID });
  });

  it('iptal edilmis siparis ikinci kez iptal edilemez', async () => {
    const { id } = await draft(input);
    await cancel({ orderId: id, userId: 'usr_1' });

    await expect(cancel({ orderId: id, userId: 'usr_1' })).rejects.toMatchObject({
      code: ERROR_CODES.ORDER_STATE_INVALID,
    });
  });

  it('baskasinin siparisi NOT_FOUND (varlik bilgisi sizmasin)', async () => {
    const { id } = await draft(input);

    await expect(cancel({ orderId: id, userId: 'usr_2' })).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
    await expect(repository.findById(id)).resolves.toMatchObject({ status: ORDER_STATUS.DRAFT });
  });
});
