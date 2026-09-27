/**
 * Charge use-case: test kartlari, kapida odeme, idempotency ve cift cekim korumasi.
 */

import { AppError, ERROR_CODES, fixedClock, ID_PREFIX, isId, silentLogger } from '@getir/core';
import type { Logger } from '@getir/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCharge } from '../../src/application/charge.js';
import type { ChargeInput } from '../../src/application/charge.js';
import { THREEDS_CHALLENGE_TTL_MS } from '../../src/config/constants.js';
import { PAYMENT_METHOD, PAYMENT_STATUS } from '../../src/domain/payment.js';
import type { Payment } from '../../src/domain/payment.js';
import type { PaymentProvider } from '../../src/domain/payment-provider.js';
import { InMemoryPaymentStore } from '../../src/infrastructure/memory/in-memory-payment-store.js';
import { MockPaymentProvider } from '../../src/infrastructure/mock-provider/mock-payment-provider.js';

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);

const cardCharge = (overrides: Partial<ChargeInput> = {}): ChargeInput => ({
  orderId: 'ord_1',
  userId: 'usr_1',
  amount: { amountMinor: 12_990, currency: 'TRY' },
  method: PAYMENT_METHOD.CARD,
  cardToken: 'tok_test_4242',
  idempotencyKey: 'anahtar-0001',
  requireThreeDs: false,
  ...overrides,
});

/** Cagrinin gunlukcusu bagli use-case: testler yalnizca girdiyle cagirir. */
type ChargeCall = (input: ChargeInput) => Promise<Payment>;

let repository: InMemoryPaymentStore;
let charge: ChargeCall;

function build(
  provider: Pick<PaymentProvider, 'authorize'> = new MockPaymentProvider(),
  logger: Logger = silentLogger,
): ChargeCall {
  const useCase = createCharge({
    repository,
    provider,
    clock: fixedClock(NOW),
    challengeTtlMs: THREEDS_CHALLENGE_TTL_MS,
  });
  return (input) => useCase(input, logger);
}

/** Yalnizca error cagrilarini kaydeden gunlukcu. */
function recordingLogger(): { logger: Logger; error: ReturnType<typeof vi.fn> } {
  const error = vi.fn();
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error,
    fatal: () => undefined,
    child: () => logger,
  };
  return { logger, error };
}

beforeEach(() => {
  repository = new InMemoryPaymentStore();
  charge = build();
});

describe('Charge - test kartlari', () => {
  it('4242 karti onaylanir: SUCCEEDED', async () => {
    const payment = await charge(cardCharge());

    expect(payment.status).toBe(PAYMENT_STATUS.SUCCEEDED);
    expect(payment.id).toMatch(/^pay_[0-9a-f]{32}$/);
    expect(payment.failureCode).toBeUndefined();
    expect(await repository.findByOrderId('ord_1')).toEqual(payment);
  });

  it('4000...0002 karti reddedilir: hata degil FAILED + PAYMENT_DECLINED', async () => {
    const payment = await charge(cardCharge({ cardToken: 'tok_test_0002' }));

    expect(payment.status).toBe(PAYMENT_STATUS.FAILED);
    expect(payment.failureCode).toBe(ERROR_CODES.PAYMENT_DECLINED);
  });

  it('3DS karti REQUIRES_3DS doner; jeton 60 sn gecerli', async () => {
    const payment = await charge(cardCharge({ cardToken: 'tok_test_3184' }));

    expect(payment.status).toBe(PAYMENT_STATUS.REQUIRES_3DS);
    expect(payment.challenge?.id).toMatch(/^tds_[0-9a-f]{32}$/);
    expect(isId(ID_PREFIX.THREEDS_CHALLENGE, payment.challenge?.id)).toBe(true);
    expect(payment.challenge?.expiresAt.getTime()).toBe(NOW + THREEDS_CHALLENGE_TTL_MS);
  });

  it('cekim karari attempts[] gecmisine yazilir; kapida odemede gecmis bos', async () => {
    const card = await charge(cardCharge({ cardToken: 'tok_test_0002' }));
    expect(card.attempts.map((a) => a.outcome)).toEqual(['DECLINED']);
    expect(card.attempts[0]?.at).toEqual(new Date(NOW));

    const cash = await charge(
      cardCharge({
        orderId: 'ord_2',
        idempotencyKey: 'anahtar-0002',
        method: PAYMENT_METHOD.CASH_ON_DELIVERY,
        cardToken: undefined,
      }),
    );
    expect(cash.attempts).toEqual([]);
  });

  it('taninmayan jeton reddedilir', async () => {
    const payment = await charge(cardCharge({ cardToken: 'tok_bilinmeyen' }));
    expect(payment.failureCode).toBe(ERROR_CODES.PAYMENT_DECLINED);
  });
});

describe('Charge - risk bandina gore 3DS (T7.1)', () => {
  it('3DS zorunluysa onaylanacak kart bile REQUIRES_3DS doner; karar gecmiste gorunur', async () => {
    const payment = await charge(cardCharge({ requireThreeDs: true }));

    expect(payment.status).toBe(PAYMENT_STATUS.REQUIRES_3DS);
    expect(payment.challenge?.id).toMatch(/^tds_/);
    expect(payment.attempts.map((attempt) => attempt.outcome)).toEqual(['CHALLENGE_REQUIRED']);
  });

  it('reddedilecek kart 3DS e gitmez, yine FAILED + PAYMENT_DECLINED', async () => {
    const payment = await charge(cardCharge({ cardToken: 'tok_test_0002', requireThreeDs: true }));

    expect(payment.status).toBe(PAYMENT_STATUS.FAILED);
    expect(payment.failureCode).toBe(ERROR_CODES.PAYMENT_DECLINED);
    expect(payment.challenge).toBeUndefined();
  });

  it('bayrak cekim niyetinin parcasi degil: ayni anahtarli tekrar istek ilk kaydi doner', async () => {
    const first = await charge(cardCharge({ requireThreeDs: true }));

    await expect(charge(cardCharge({ requireThreeDs: false }))).resolves.toEqual(first);
  });
});

describe('Charge - kapida odeme', () => {
  it('saglayiciya gitmez, PENDING kalir', async () => {
    const authorize = vi.fn<PaymentProvider['authorize']>();
    charge = build({ authorize });

    const payment = await charge(
      cardCharge({ method: PAYMENT_METHOD.CASH_ON_DELIVERY, cardToken: undefined }),
    );

    expect(payment.status).toBe(PAYMENT_STATUS.PENDING);
    expect(authorize).not.toHaveBeenCalled();
  });
});

describe('Charge - idempotency (ADR-08)', () => {
  it('ayni anahtarla ikinci istek ilk kaydi doner, tekrar cekmez', async () => {
    const authorize = vi.fn<PaymentProvider['authorize']>().mockResolvedValue('APPROVED');
    charge = build({ authorize });

    const first = await charge(cardCharge());
    const second = await charge(cardCharge());

    expect(second).toEqual(first);
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(repository.size).toBe(1);
  });

  it('reddedilen cekimin tekrari da ayni red kaydini doner', async () => {
    const first = await charge(cardCharge({ cardToken: 'tok_test_0002' }));
    expect(await charge(cardCharge({ cardToken: 'tok_test_0002' }))).toEqual(first);
  });

  it('ayni anahtar farkli tutarla gelirse CONFLICT', async () => {
    await charge(cardCharge());

    await expect(
      charge(cardCharge({ amount: { amountMinor: 1, currency: 'TRY' } })),
    ).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
  });

  it('ayni siparise farkli anahtarla ikinci odeme CONFLICT', async () => {
    await charge(cardCharge());

    await expect(charge(cardCharge({ idempotencyKey: 'anahtar-0002' }))).rejects.toBeInstanceOf(
      AppError,
    );
    await expect(charge(cardCharge({ idempotencyKey: 'anahtar-0002' }))).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
    });
  });

  it('es zamanli ayni anahtar: saglayiciya tek kez gidilir, ikisi ayni kaydi gorur', async () => {
    const authorize = vi.fn<PaymentProvider['authorize']>().mockResolvedValue('APPROVED');
    charge = build({ authorize });

    const [a, b] = await Promise.all([charge(cardCharge()), charge(cardCharge())]);

    expect(authorize).toHaveBeenCalledTimes(1);
    expect(a.id).toBe(b.id);
    expect(repository.size).toBe(1);
  });
});

describe('Charge - saglayici hatasi', () => {
  it('saglayiciya ulasilamazsa tutar cekilmez: FAILED + SERVICE_UNAVAILABLE', async () => {
    charge = build({ authorize: () => Promise.reject(new Error('baglanti koptu')) });

    const payment = await charge(cardCharge());

    expect(payment.status).toBe(PAYMENT_STATUS.FAILED);
    expect(payment.failureCode).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
    expect(payment.attempts.map((a) => a.outcome)).toEqual(['PROVIDER_ERROR']);
    expect((await repository.findByOrderId('ord_1'))?.status).toBe(PAYMENT_STATUS.FAILED);
  });

  it('hata, CAGRININ gunlukcusune (requestId bagli) siparis kimligiyle yazilir', async () => {
    // Handler ctx.logger'i gecer; use-case servis geneli bir gunlukcu tutmaz,
    // yoksa bu satirda requestId olmaz ve hata hangi istege ait bulunamaz.
    const { logger, error } = recordingLogger();
    const cause = new Error('baglanti koptu');
    charge = build({ authorize: () => Promise.reject(cause) }, logger);

    await charge(cardCharge());

    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      { err: cause, orderId: 'ord_1' },
      'odeme saglayicisina ulasilamadi',
    );
  });
});
