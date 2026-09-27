/**
 * Use-case: kullanici iptali (B29). Bellek deposu, sabit saat.
 */

import { AppError, ERROR_CODES, fixedClock, ORDER_STATUS } from '@getir/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { createCancelOrder } from '../../src/application/cancel-order.js';
import { transitionOrder } from '../../src/domain/order.js';
import { InMemoryOrderStore } from '../../src/infrastructure/memory/in-memory-order-store.js';
import { insertAwaitingPayment, insertDraft } from '../support/order-builders.js';

const clock = fixedClock(1_760_000_000_000);

let repository: InMemoryOrderStore;
let cancel: ReturnType<typeof createCancelOrder>;

beforeEach(() => {
  repository = new InMemoryOrderStore();
  cancel = createCancelOrder({ repository, clock });
});

describe('cancelOrder use-case', () => {
  it('DRAFT siparisi iptal eder; gerekce yoksa USER_CANCELLED yazar', async () => {
    const { id } = await insertDraft(repository, clock);

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
    const { id } = await insertAwaitingPayment(repository, clock);

    const order = await cancel({ orderId: id, userId: 'usr_1', reason: 'CHANGED_MIND' });

    expect(order.timeline.at(-1)?.note).toBe('CHANGED_MIND');
  });

  it('odenmis siparisi kullanici iptal EDEMEZ (iade sistemin telafi adimi, B20c)', async () => {
    const awaiting = await insertAwaitingPayment(repository, clock);
    const { id } = awaiting;
    await repository.update(transitionOrder(awaiting, ORDER_STATUS.PAID, clock), awaiting.version);

    const failing = cancel({ orderId: id, userId: 'usr_1' });

    await expect(failing).rejects.toBeInstanceOf(AppError);
    await expect(failing).rejects.toMatchObject({
      code: ERROR_CODES.ORDER_STATE_INVALID,
      details: { orderId: id, status: ORDER_STATUS.PAID },
    });
    await expect(repository.findById(id)).resolves.toMatchObject({ status: ORDER_STATUS.PAID });
  });

  it('iptal edilmis siparis ikinci kez iptal edilemez', async () => {
    const { id } = await insertDraft(repository, clock);
    await cancel({ orderId: id, userId: 'usr_1' });

    await expect(cancel({ orderId: id, userId: 'usr_1' })).rejects.toMatchObject({
      code: ERROR_CODES.ORDER_STATE_INVALID,
    });
  });

  it('baskasinin siparisi NOT_FOUND (varlik bilgisi sizmasin)', async () => {
    const { id } = await insertDraft(repository, clock);

    await expect(cancel({ orderId: id, userId: 'usr_2' })).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
    await expect(repository.findById(id)).resolves.toMatchObject({ status: ORDER_STATUS.DRAFT });
  });
});
