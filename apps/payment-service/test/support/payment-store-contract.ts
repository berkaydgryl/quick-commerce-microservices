/**
 * Odeme deposu SOZLESME testi: ayni senaryolar bellekte (unit) ve gercek
 * Mongo'da (integration) kosar. Iki depo ayni unique kurallarini, ayni surum
 * kontrolunu ve ayni hatalari gostermeli; alan kaybi olmamali.
 *
 * Mongo'da koleksiyon testler arasinda paylasilir; bu yuzden her test kendi
 * siparisini ve anahtarini (benzersiz) acar.
 */

import { ERROR_CODES, fixedClock } from '@getir/core';
import { describe, expect, it } from 'vitest';

import {
  ATTEMPT_KIND,
  ATTEMPT_OUTCOME,
  PAYMENT_METHOD,
  PAYMENT_STATUS,
  startPayment,
  THREEDS_CLOSE_REASON,
} from '../../src/domain/payment.js';
import type { ChargeCommand, Payment } from '../../src/domain/payment.js';
import type { PaymentRepository } from '../../src/domain/payment-repository.js';

const START_MS = 1_760_000_000_000;

export function describePaymentStoreContract(
  name: string,
  getStore: () => PaymentRepository,
): void {
  let counter = 0;
  const command = (): ChargeCommand => {
    counter += 1;
    return {
      orderId: `ord_contract-${name}-${counter}`,
      userId: 'usr_1',
      amount: { amountMinor: 12_990, currency: 'TRY' },
      method: PAYMENT_METHOD.CARD,
      idempotencyKey: `anahtar-${name}-${counter}`,
    };
  };
  const pending = (): Payment => startPayment(command(), fixedClock(START_MS));

  describe(`PaymentRepository sozlesmesi: ${name}`, () => {
    it('yeni kayit ALAN KAYBI olmadan geri okunur (bos attempts, istege bagli alan yok)', async () => {
      const store = getStore();
      const payment = pending();

      await store.insert(payment);

      expect(await store.findByOrderId(payment.orderId)).toEqual(payment);
    });

    it('3DS kilitli odeme: challenge, closedReason, failureCode ve attempts birebir korunur', async () => {
      const store = getStore();
      const at = new Date(START_MS + 5_000);
      const locked: Payment = {
        ...pending(),
        status: PAYMENT_STATUS.FAILED,
        failureCode: ERROR_CODES.THREEDS_FAILED,
        challenge: {
          id: 'tds_0123456789abcdef0123456789abcdef',
          expiresAt: new Date(START_MS + 60_000),
          failedAttempts: 3,
          closedReason: THREEDS_CLOSE_REASON.ATTEMPTS_EXHAUSTED,
        },
        attempts: [
          { kind: ATTEMPT_KIND.CHARGE, outcome: ATTEMPT_OUTCOME.CHALLENGE_REQUIRED, at },
          { kind: ATTEMPT_KIND.THREEDS, outcome: ATTEMPT_OUTCOME.CODE_REJECTED, at },
        ],
        version: 4,
      };

      await store.insert(locked);

      expect(await store.findByOrderId(locked.orderId)).toEqual(locked);
      expect(await store.findByIdempotencyKey(locked.idempotencyKey)).toEqual(locked);
    });

    it('olmayan siparis ve anahtar null doner', async () => {
      const store = getStore();
      expect(await store.findByOrderId('ord_hic-yok')).toBeNull();
      expect(await store.findByIdempotencyKey('anahtar-hic-yok')).toBeNull();
    });

    it('ayni siparise ikinci kayit CONFLICT (siparis basina tek odeme)', async () => {
      const store = getStore();
      const first = pending();
      await store.insert(first);

      const second = { ...pending(), orderId: first.orderId };
      await expect(store.insert(second)).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
    });

    it('ayni anahtarla baska siparis CONFLICT (ADR-08)', async () => {
      const store = getStore();
      const first = pending();
      await store.insert(first);

      const second = { ...pending(), idempotencyKey: first.idempotencyKey };
      await expect(store.insert(second)).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
    });

    it('dogru surumle guncelleme yazilir', async () => {
      const store = getStore();
      const payment = pending();
      await store.insert(payment);

      const updated: Payment = { ...payment, status: PAYMENT_STATUS.SUCCEEDED, version: 1 };
      await store.update(updated, 0);

      expect(await store.findByOrderId(payment.orderId)).toEqual(updated);
    });

    it('beklenen surum tutmazsa CONFLICT, kayit degismez (iyimser kilit)', async () => {
      const store = getStore();
      const payment = pending();
      await store.insert(payment);
      await store.update({ ...payment, version: 1 }, 0);

      await expect(
        store.update({ ...payment, status: PAYMENT_STATUS.FAILED, version: 1 }, 0),
      ).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
      expect((await store.findByOrderId(payment.orderId))?.status).toBe(PAYMENT_STATUS.PENDING);
    });

    it('olmayan kaydi guncellemek NOT_FOUND', async () => {
      const store = getStore();
      await expect(store.update(pending(), 0)).rejects.toMatchObject({
        code: ERROR_CODES.NOT_FOUND,
      });
    });
  });
}
