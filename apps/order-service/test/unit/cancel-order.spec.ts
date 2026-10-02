/**
 * Use-case: kullanici iptali (B29). Bellek deposu, sabit saat.
 */

import { AppError, ERROR_CODES, fixedClock, ORDER_STATUS, silentLogger } from '@getir/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { createCancelOrder } from '../../src/application/cancel-order.js';
import { transitionOrder } from '../../src/domain/order.js';
import { InMemoryOrderStore } from '../../src/infrastructure/memory/in-memory-order-store.js';
import { FakeStockReservations } from '../support/fake-stock-reservations.js';
import { insertAwaitingPayment, insertDraft } from '../support/order-builders.js';

const clock = fixedClock(1_760_000_000_000);
const scope = { requestId: 'req_iptal_1', logger: silentLogger };

let repository: InMemoryOrderStore;
let stock: FakeStockReservations;
let cancel: ReturnType<typeof createCancelOrder>;

beforeEach(() => {
  repository = new InMemoryOrderStore();
  stock = new FakeStockReservations();
  cancel = createCancelOrder({ repository, stock, clock });
});

describe('cancelOrder use-case', () => {
  it('DRAFT siparisi iptal eder; gerekce yoksa USER_CANCELLED yazar', async () => {
    const { id } = await insertDraft(repository, clock);

    const order = await cancel({ orderId: id, userId: 'usr_1' }, scope);

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

    const order = await cancel({ orderId: id, userId: 'usr_1', reason: 'CHANGED_MIND' }, scope);

    expect(order.timeline.at(-1)?.note).toBe('CHANGED_MIND');
    // Iptal de bir gecistir: olayi gerekcesiyle yazilir (T7.3).
    expect(repository.recordedEvents.at(-1)).toMatchObject({
      topic: 'order.status_changed',
      orderId: id,
      payload: { from: 'AWAITING_PAYMENT', to: 'CANCELLED', note: 'CHANGED_MIND' },
    });
  });

  it('odenmis siparisi kullanici iptal EDEMEZ (iade sistemin telafi adimi, B20c)', async () => {
    const awaiting = await insertAwaitingPayment(repository, clock);
    const { id } = awaiting;
    await repository.update(
      transitionOrder(awaiting, ORDER_STATUS.PAID, clock),
      awaiting.version,
      [],
    );

    const failing = cancel({ orderId: id, userId: 'usr_1' }, scope);

    await expect(failing).rejects.toBeInstanceOf(AppError);
    await expect(failing).rejects.toMatchObject({
      code: ERROR_CODES.ORDER_STATE_INVALID,
      details: { orderId: id, status: ORDER_STATUS.PAID },
    });
    await expect(repository.findById(id)).resolves.toMatchObject({ status: ORDER_STATUS.PAID });
  });

  it('iptal edilmis siparis ikinci kez iptal edilemez', async () => {
    const { id } = await insertDraft(repository, clock);
    await cancel({ orderId: id, userId: 'usr_1' }, scope);

    await expect(cancel({ orderId: id, userId: 'usr_1' }, scope)).rejects.toMatchObject({
      code: ERROR_CODES.ORDER_STATE_INVALID,
    });
  });

  it.each([
    ['taslak', () => insertDraft(repository, clock)],
    ['odeme bekleyen', () => insertAwaitingPayment(repository, clock)],
  ])(
    '%s siparisin stok kilidi iptalden SONRA birakilir (user_cancelled, T11.2)',
    async (_name, given) => {
      const { id, marketId } = await given();

      await cancel({ orderId: id, userId: 'usr_1' }, scope);

      expect(stock.releases).toEqual([{ orderId: id, marketId, reason: 'user_cancelled' }]);
    },
  );

  it('kilit birakilamazsa iptal yine basarili (kilit suresi dolunca inventory geri verir)', async () => {
    stock.releaseFailure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'inventory yok');
    const { id } = await insertDraft(repository, clock);

    const order = await cancel({ orderId: id, userId: 'usr_1' }, scope);

    expect(order.status).toBe(ORDER_STATUS.CANCELLED);
    expect(stock.releases).toHaveLength(1);
  });

  it("kilidi olmayan eski taslakta (T11.2 oncesi) inventory'ye gidilmez", async () => {
    const { id } = await insertDraft(repository, clock, {}, { reservation: null });

    await cancel({ orderId: id, userId: 'usr_1' }, scope);

    expect(stock.releases).toEqual([]);
  });

  it('iptal reddedilirse (odenmis siparis) kilide dokunulmaz', async () => {
    const draft = await insertDraft(repository, clock);
    const paid = [
      ORDER_STATUS.RISK_CHECK,
      ORDER_STATUS.RESERVED,
      ORDER_STATUS.AWAITING_PAYMENT,
      ORDER_STATUS.PAID,
    ].reduce((order, status) => transitionOrder(order, status, clock), draft);
    await repository.update(paid, draft.version, []);

    await expect(cancel({ orderId: draft.id, userId: 'usr_1' }, scope)).rejects.toBeInstanceOf(
      AppError,
    );
    expect(stock.releases).toEqual([]);
  });

  it('baskasinin siparisi NOT_FOUND (varlik bilgisi sizmasin)', async () => {
    const { id } = await insertDraft(repository, clock);

    await expect(cancel({ orderId: id, userId: 'usr_2' }, scope)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
    await expect(repository.findById(id)).resolves.toMatchObject({ status: ORDER_STATUS.DRAFT });
  });
});
