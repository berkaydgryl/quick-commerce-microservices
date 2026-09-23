/**
 * Confirm3Ds use-case: karar belgesindeki matris, zaman siniri, tekrar istek
 * ve es zamanli deneme (iyimser kilit). Saat sabit, saglayici mock.
 */

import { AppError, ERROR_CODES, fixedClock, MOCK_THREEDS_CODE } from '@getir/core';
import type { MutableClock } from '@getir/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCharge } from '../../src/application/charge.js';
import { createConfirm3Ds } from '../../src/application/confirm-3ds.js';
import type { Confirm3Ds } from '../../src/application/confirm-3ds.js';
import {
  CONFIRM_3DS_MAX_WRITE_RETRIES,
  THREEDS_CHALLENGE_TTL_MS,
  THREEDS_MAX_ATTEMPTS,
} from '../../src/config/constants.js';
import { PAYMENT_METHOD, PAYMENT_STATUS } from '../../src/domain/payment.js';
import type { Payment } from '../../src/domain/payment.js';
import type { PaymentProvider } from '../../src/domain/payment-provider.js';
import { InMemoryPaymentStore } from '../../src/infrastructure/memory/in-memory-payment-store.js';
import { MockPaymentProvider } from '../../src/infrastructure/mock-provider/mock-payment-provider.js';

const START = Date.UTC(2026, 8, 23, 12, 0, 0);
const WRONG_CODE = '000000';

let clock: MutableClock;
let repository: InMemoryPaymentStore;
let confirm: Confirm3Ds;
let challengeId: string;

function build(
  provider: Pick<PaymentProvider, 'verifyChallenge'> = new MockPaymentProvider(),
): Confirm3Ds {
  return createConfirm3Ds({
    repository,
    provider,
    clock,
    maxAttempts: THREEDS_MAX_ATTEMPTS,
    maxWriteRetries: CONFIRM_3DS_MAX_WRITE_RETRIES,
  });
}

/** 3DS isteyen kartla cekim: REQUIRES_3DS odeme ve jetonu hazirlar. */
async function chargeWith3Ds(orderId = 'ord_1'): Promise<Payment> {
  const charge = createCharge({
    repository,
    provider: new MockPaymentProvider(),
    clock,
    challengeTtlMs: THREEDS_CHALLENGE_TTL_MS,
  });
  return charge({
    orderId,
    userId: 'usr_1',
    amount: { amountMinor: 12_990, currency: 'TRY' },
    method: PAYMENT_METHOD.CARD,
    cardToken: 'tok_test_3184',
    idempotencyKey: `anahtar-${orderId}`,
  });
}

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof AppError)) {
    throw new Error('AppError bekleniyordu');
  }
  return error;
}

const stored = async (): Promise<Payment | null> => repository.findByOrderId('ord_1');

beforeEach(async () => {
  clock = fixedClock(START);
  repository = new InMemoryPaymentStore();
  confirm = build();
  const payment = await chargeWith3Ds();
  challengeId = payment.challenge?.id ?? '';
});

describe('Confirm3Ds - matris', () => {
  it('dogru kod: REQUIRES_3DS -> SUCCEEDED', async () => {
    const payment = await confirm({ orderId: 'ord_1', challengeId, code: MOCK_THREEDS_CODE });

    expect(payment.status).toBe(PAYMENT_STATUS.SUCCEEDED);
    expect((await stored())?.status).toBe(PAYMENT_STATUS.SUCCEEDED);
  });

  it('1. ve 2. yanlis kod: THREEDS_FAILED, kalan hak 2 ve 1, odeme REQUIRES_3DS kalir', async () => {
    const first = await rejection(confirm({ orderId: 'ord_1', challengeId, code: WRONG_CODE }));
    expect(first.code).toBe(ERROR_CODES.THREEDS_FAILED);
    expect(first.details).toEqual({ attemptsLeft: 2, reason: 'wrong_code' });

    const second = await rejection(confirm({ orderId: 'ord_1', challengeId, code: WRONG_CODE }));
    expect(second.details).toEqual({ attemptsLeft: 1, reason: 'wrong_code' });

    const payment = await stored();
    expect(payment?.status).toBe(PAYMENT_STATUS.REQUIRES_3DS);
    expect(payment?.challenge?.failedAttempts).toBe(2);
  });

  it('ikinci yanlistan sonra dogru kod hala kabul edilir (B5)', async () => {
    await rejection(confirm({ orderId: 'ord_1', challengeId, code: WRONG_CODE }));
    await rejection(confirm({ orderId: 'ord_1', challengeId, code: WRONG_CODE }));

    const payment = await confirm({ orderId: 'ord_1', challengeId, code: MOCK_THREEDS_CODE });
    expect(payment.status).toBe(PAYMENT_STATUS.SUCCEEDED);
  });

  it('3. yanlis kod: FAILED + THREEDS_FAILED, dogrulama kilitlenir', async () => {
    for (let i = 0; i < THREEDS_MAX_ATTEMPTS - 1; i += 1) {
      await rejection(confirm({ orderId: 'ord_1', challengeId, code: WRONG_CODE }));
    }
    const last = await rejection(confirm({ orderId: 'ord_1', challengeId, code: WRONG_CODE }));

    expect(last.details).toEqual({ attemptsLeft: 0, reason: 'attempts_exhausted' });
    const payment = await stored();
    expect(payment?.status).toBe(PAYMENT_STATUS.FAILED);
    expect(payment?.failureCode).toBe(ERROR_CODES.THREEDS_FAILED);
  });

  it('kilitten sonra dogru kod da kabul edilmez; ayni sebep yeniden doner', async () => {
    for (let i = 0; i < THREEDS_MAX_ATTEMPTS; i += 1) {
      await rejection(confirm({ orderId: 'ord_1', challengeId, code: WRONG_CODE }));
    }
    const after = await rejection(
      confirm({ orderId: 'ord_1', challengeId, code: MOCK_THREEDS_CODE }),
    );

    expect(after.code).toBe(ERROR_CODES.THREEDS_FAILED);
    expect(after.details).toEqual({ attemptsLeft: 0, reason: 'attempts_exhausted' });
    expect((await stored())?.status).toBe(PAYMENT_STATUS.FAILED);
  });
});

describe('Confirm3Ds - 60 sn siniri', () => {
  it('59. saniyede dogru kod kabul edilir', async () => {
    clock.advance(THREEDS_CHALLENGE_TTL_MS - 1000);
    const payment = await confirm({ orderId: 'ord_1', challengeId, code: MOCK_THREEDS_CODE });
    expect(payment.status).toBe(PAYMENT_STATUS.SUCCEEDED);
  });

  it('60. saniyede ve sonrasinda dogru kod bile reddedilir: FAILED (expired)', async () => {
    clock.advance(THREEDS_CHALLENGE_TTL_MS);
    const error = await rejection(
      confirm({ orderId: 'ord_1', challengeId, code: MOCK_THREEDS_CODE }),
    );

    expect(error.code).toBe(ERROR_CODES.THREEDS_FAILED);
    expect(error.details).toEqual({ attemptsLeft: 0, reason: 'expired' });
    expect((await stored())?.status).toBe(PAYMENT_STATUS.FAILED);
  });

  it('suresi dolan dogrulamada saglayiciya gidilmez', async () => {
    const verifyChallenge = vi.fn<PaymentProvider['verifyChallenge']>();
    confirm = build({ verifyChallenge });
    clock.advance(THREEDS_CHALLENGE_TTL_MS + 1);

    await rejection(confirm({ orderId: 'ord_1', challengeId, code: MOCK_THREEDS_CODE }));
    expect(verifyChallenge).not.toHaveBeenCalled();
  });
});

describe('Confirm3Ds - bulunamayan', () => {
  it('bilinmeyen jeton NOT_FOUND, kayit degismez', async () => {
    const error = await rejection(
      confirm({ orderId: 'ord_1', challengeId: 'tds_yok', code: MOCK_THREEDS_CODE }),
    );
    expect(error.code).toBe(ERROR_CODES.NOT_FOUND);
    expect((await stored())?.status).toBe(PAYMENT_STATUS.REQUIRES_3DS);
  });

  it('baska siparisin jetonu NOT_FOUND', async () => {
    const other = await chargeWith3Ds('ord_2');
    const error = await rejection(
      confirm({
        orderId: 'ord_1',
        challengeId: other.challenge?.id ?? '',
        code: MOCK_THREEDS_CODE,
      }),
    );
    expect(error.code).toBe(ERROR_CODES.NOT_FOUND);
  });

  it('odemesi olmayan siparis NOT_FOUND', async () => {
    const error = await rejection(
      confirm({ orderId: 'ord_yok', challengeId, code: MOCK_THREEDS_CODE }),
    );
    expect(error.code).toBe(ERROR_CODES.NOT_FOUND);
  });
});

describe('Confirm3Ds - tekrar istek ve es zamanlilik', () => {
  it('basaridan sonra ayni jetonla tekrar: ayni basarili kayit, saglayiciya gidilmez', async () => {
    const first = await confirm({ orderId: 'ord_1', challengeId, code: MOCK_THREEDS_CODE });
    const verifyChallenge = vi.fn<PaymentProvider['verifyChallenge']>();
    confirm = build({ verifyChallenge });

    const again = await confirm({ orderId: 'ord_1', challengeId, code: MOCK_THREEDS_CODE });

    expect(again).toEqual(first);
    expect(verifyChallenge).not.toHaveBeenCalled();
  });

  it('es zamanli iki yanlis kod iki hak yakar, tek degil (iyimser kilit)', async () => {
    await Promise.all([
      rejection(confirm({ orderId: 'ord_1', challengeId, code: WRONG_CODE })),
      rejection(confirm({ orderId: 'ord_1', challengeId, code: WRONG_CODE })),
    ]);

    expect((await stored())?.challenge?.failedAttempts).toBe(2);
  });

  it('es zamanli uc yanlis kod dogrulamayi kilitler', async () => {
    const errors = await Promise.all(
      Array.from({ length: THREEDS_MAX_ATTEMPTS }, () =>
        rejection(confirm({ orderId: 'ord_1', challengeId, code: WRONG_CODE })),
      ),
    );

    expect(errors.map((e) => e.code)).toEqual(
      Array(THREEDS_MAX_ATTEMPTS).fill(ERROR_CODES.THREEDS_FAILED),
    );
    expect((await stored())?.status).toBe(PAYMENT_STATUS.FAILED);
  });

  it('saglayiciya ulasilamazsa deneme sayilmaz, SERVICE_UNAVAILABLE', async () => {
    confirm = build({ verifyChallenge: () => Promise.reject(new Error('banka yok')) });

    const error = await rejection(confirm({ orderId: 'ord_1', challengeId, code: WRONG_CODE }));

    expect(error.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
    expect((await stored())?.challenge?.failedAttempts).toBe(0);
  });
});
