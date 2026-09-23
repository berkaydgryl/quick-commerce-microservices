/**
 * Bellek deposu, Mongo'daki unique indekslerin (orderId, idempotencyKey)
 * davranisini taklit etmeli: use-case iki depoda da ayni hatayi gormeli.
 */

import { ERROR_CODES, fixedClock } from '@getir/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { PAYMENT_METHOD, startPayment } from '../../src/domain/payment.js';
import type { ChargeCommand } from '../../src/domain/payment.js';
import { InMemoryPaymentStore } from '../../src/infrastructure/memory/in-memory-payment-store.js';

const clock = fixedClock(Date.UTC(2026, 8, 23));

const command = (overrides: Partial<ChargeCommand> = {}): ChargeCommand => ({
  orderId: 'ord_1',
  userId: 'usr_1',
  amount: { amountMinor: 100, currency: 'TRY' },
  method: PAYMENT_METHOD.CARD,
  idempotencyKey: 'anahtar-0001',
  ...overrides,
});

let store: InMemoryPaymentStore;

beforeEach(() => {
  store = new InMemoryPaymentStore();
});

describe('InMemoryPaymentStore', () => {
  it('siparis ve anahtarla bulur', async () => {
    const payment = startPayment(command(), clock);
    await store.insert(payment);

    expect(await store.findByOrderId('ord_1')).toEqual(payment);
    expect(await store.findByIdempotencyKey('anahtar-0001')).toEqual(payment);
    expect(await store.findByIdempotencyKey('yok-000000')).toBeNull();
  });

  it('ayni siparise ikinci kayit CONFLICT', async () => {
    await store.insert(startPayment(command(), clock));
    await expect(
      store.insert(startPayment(command({ idempotencyKey: 'anahtar-0002' }), clock)),
    ).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
  });

  it('ayni anahtarla baska siparis CONFLICT', async () => {
    await store.insert(startPayment(command(), clock));
    await expect(
      store.insert(startPayment(command({ orderId: 'ord_2' }), clock)),
    ).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
    });
  });

  it('olmayan kaydi guncellemek NOT_FOUND', async () => {
    await expect(store.update(startPayment(command(), clock))).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
  });
});
