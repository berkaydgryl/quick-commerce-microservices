/**
 * Use-case testi: sahte depo (bellek) ile, ag ve veritabani olmadan.
 */

import { AppError, ERROR_CODES, ORDER_STATUS, systemClock } from '@getir/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { createCreateDraftOrder } from '../../src/application/create-draft-order.js';
import { createCreateOrder } from '../../src/application/create-order.js';
import { InMemoryOrderStore } from '../../src/infrastructure/memory/in-memory-order-store.js';

let repository: InMemoryOrderStore;
let draft: ReturnType<typeof createCreateDraftOrder>;
let create: ReturnType<typeof createCreateOrder>;

const input = {
  userId: 'usr_1',
  marketId: 'mkt_migros-jet-moda',
  lines: [{ productId: 'prd_01', sku: 'SUT-1L', quantity: 1 }],
  deliveryLocation: { lat: 40.99, lng: 29.02 },
  deliveryAddress: 'Kadıköy',
};

beforeEach(() => {
  repository = new InMemoryOrderStore();
  draft = createCreateDraftOrder({ repository, clock: systemClock });
  create = createCreateOrder({ repository, clock: systemClock });
});

describe('createDraftOrder use-case', () => {
  it('siparisi kaydeder ve kimligini doner', async () => {
    const order = await draft(input);

    expect(repository.size).toBe(1);
    await expect(repository.findById(order.id)).resolves.toMatchObject({
      status: ORDER_STATUS.DRAFT,
    });
  });
});

describe('createOrder use-case', () => {
  it('taslagi AWAITING_PAYMENT durumuna gecirir', async () => {
    const { id } = await draft(input);

    const order = await create({ orderId: id, userId: 'usr_1' });

    expect(order.status).toBe(ORDER_STATUS.AWAITING_PAYMENT);
    // Yeni kayit acilmaz, ayni siparis guncellenir.
    expect(repository.size).toBe(1);
  });

  it('tablodaki yolu ADIM ADIM yurur; gecici adimlar nedeniyle zaman cizelgesinde (T4.4)', async () => {
    const { id } = await draft(input);

    const order = await create({ orderId: id, userId: 'usr_1' });

    expect(order.timeline.map((entry) => [entry.status, entry.note])).toEqual([
      [ORDER_STATUS.DRAFT, undefined],
      // risk-svc (T6.3) ve rezervasyon (T11.2) henuz yok: sessizce atlanmaz.
      [ORDER_STATUS.RISK_CHECK, 'PENDING_RISK_SERVICE'],
      [ORDER_STATUS.RESERVED, 'PENDING_RESERVATION'],
      [ORDER_STATUS.AWAITING_PAYMENT, undefined],
    ]);
    await expect(repository.findById(id)).resolves.toMatchObject({ timeline: order.timeline });
  });

  it('olmayan sipariste NOT_FOUND verir', async () => {
    const failing = create({ orderId: 'ord_yok', userId: 'usr_1' });

    await expect(failing).rejects.toBeInstanceOf(AppError);
    await expect(failing).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
  });

  it('baskasinin siparisinde de NOT_FOUND verir (varlik bilgisi sizmasin)', async () => {
    const { id } = await draft(input);

    // PERMISSION_DENIED donseydi "bu kimlikte siparis var" bilgisi sizardi.
    await expect(create({ orderId: id, userId: 'usr_2' })).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
  });

  it('ayni siparis iki kez olusturulamaz', async () => {
    const { id } = await draft(input);
    await create({ orderId: id, userId: 'usr_1' });

    await expect(create({ orderId: id, userId: 'usr_1' })).rejects.toMatchObject({
      code: ERROR_CODES.ORDER_STATE_INVALID,
    });
    // Basarisiz ikinci deneme kayitli siparisi DEGISTIRMEZ.
    await expect(repository.findById(id)).resolves.toMatchObject({
      status: ORDER_STATUS.AWAITING_PAYMENT,
    });
  });

  it('ayni taslaga ES ZAMANLI iki CreateOrder: biri gecer, digeri CONFLICT (surum kontrolu)', async () => {
    const { id } = await draft(input);

    // Ikisi de taslagi DRAFT olarak okur; surum kontrolu olmasa ikisi de yazardi.
    const results = await Promise.allSettled([
      create({ orderId: id, userId: 'usr_1' }),
      create({ orderId: id, userId: 'usr_1' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: ERROR_CODES.CONFLICT },
    });
    await expect(repository.findById(id)).resolves.toMatchObject({
      status: ORDER_STATUS.AWAITING_PAYMENT,
      // DRAFT(1) -> RISK_CHECK -> RESERVED -> AWAITING_PAYMENT: tek yurume, uc gecis.
      version: 4,
    });
  });
});
