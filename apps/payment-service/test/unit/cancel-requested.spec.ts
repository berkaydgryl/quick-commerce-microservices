/**
 * Iptal komutu tuketicisi (T11.2 PR 3): payment.cancel_requested -> CancelPayment.
 * Bellek deposu ve mock saglayici; Redis yok (uctan uca yol test/integration'da).
 */

import { AppError, ERROR_CODES, fixedClock, ID_PREFIX, newId, silentLogger } from '@getir/core';
import type { LogFields, Logger } from '@getir/core';
import type { EventHandler } from '@getir/event-bus';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCancelPayment } from '../../src/application/cancel-payment.js';
import { PAYMENT_METHOD, PAYMENT_STATUS } from '../../src/domain/payment.js';
import { InMemoryPaymentStore } from '../../src/infrastructure/memory/in-memory-payment-store.js';
import { createCancelRequestedHandler } from '../../src/interfaces/workers/cancel-requested.js';
import { cancelCommand } from '../support/cancel-command.js';
import { chargeOrder } from '../support/charge-order.js';

const clock = fixedClock(Date.UTC(2026, 9, 2, 12, 0, 0));
const delivery = { attempt: 1, logger: silentLogger };

let repository: InMemoryPaymentStore;
let orderId: string;

beforeEach(() => {
  repository = new InMemoryPaymentStore();
  orderId = newId(ID_PREFIX.ORDER);
});

const handler = (): EventHandler =>
  createCancelRequestedHandler({ cancel: createCancelPayment({ repository, clock }) });
const command = (override: Record<string, unknown> = {}) =>
  cancelCommand(orderId, clock.date(), override);
const cashOnDelivery = () =>
  chargeOrder({ repository, clock, orderId, cardToken: '', cashOnDelivery: true });

describe('iptal komutu: islenir', () => {
  it('kapida odeme PENDING kapatilir; olay onaylanir', async () => {
    await cashOnDelivery();

    await expect(handler()(command(), delivery)).resolves.toEqual({ kind: 'handled' });
    await expect(repository.findByOrderId(orderId)).resolves.toMatchObject({
      status: PAYMENT_STATUS.CANCELLED,
      cancelReason: 'order_cancelled',
    });
  });

  it('kapatilacak bir sey yoksa da onaylanir: para alinmis, kayit yok, zaten kapali', async () => {
    await chargeOrder({ repository, clock, orderId, cardToken: 'tok_test_4242' });
    const otherOrder = newId(ID_PREFIX.ORDER);

    await expect(handler()(command(), delivery)).resolves.toEqual({ kind: 'handled' });
    await expect(handler()(cancelCommand(otherOrder, clock.date()), delivery)).resolves.toEqual({
      kind: 'handled',
    });
    await expect(repository.findByOrderId(orderId)).resolves.toMatchObject({
      status: PAYMENT_STATUS.SUCCEEDED,
    });
  });

  it('gunluge siparis kimligi, sonuc ve kaydin durumu yazilir', async () => {
    await cashOnDelivery();
    const info = vi.fn<(fields: LogFields, message: string) => void>();
    const logger: Logger = { ...silentLogger, info };

    await handler()(command(), { attempt: 1, logger });
    await handler()(command(), { attempt: 1, logger });

    expect(info.mock.calls).toEqual([
      [
        { orderId, outcome: 'cancelled', status: 'CANCELLED' },
        'iptal komutu: tahsil edilmemis odeme kapatildi',
      ],
      [
        { orderId, outcome: 'already-cancelled', status: 'CANCELLED' },
        'iptal komutu: odeme zaten kapatilmisti',
      ],
    ]);
  });
});

describe('iptal komutu: reddedilir ya da yeniden denenir', () => {
  it.each([
    ['siparis kimligi bicimsiz', { orderId: 'ord_1' }],
    ['gerekce metin', { reason: 'Siparis iptal edildi' }],
  ])('bozuk govde (%s) REDDEDILIR: tekrar denemek sonucu degistirmez', async (_name, override) => {
    const outcome = await handler()(command(override), delivery);

    expect(outcome).toMatchObject({ kind: 'rejected' });
  });

  it('kart cekimi suruyor: hata firlatilir, olay onaylanmaz (yeniden teslim)', async () => {
    const cod = await cashOnDelivery();
    repository = new InMemoryPaymentStore();
    await repository.insert({ ...cod, method: PAYMENT_METHOD.CARD });

    await expect(handler()(command(), delivery)).rejects.toMatchObject({
      code: ERROR_CODES.REQUEST_IN_PROGRESS,
    });
  });

  it('veritabani hatasi firlatilir (yeniden teslim)', async () => {
    await cashOnDelivery();
    vi.spyOn(repository, 'findByOrderId').mockRejectedValueOnce(
      new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'mongo kapali'),
    );

    await expect(handler()(command(), delivery)).rejects.toMatchObject({
      code: ERROR_CODES.SERVICE_UNAVAILABLE,
    });
  });
});
