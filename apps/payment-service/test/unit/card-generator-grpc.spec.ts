/**
 * Kart uretici numarasiyla uctan uca, gRPC (bekleyen is 112): kart kasasi ve
 * odeme servisi AYNI sunucuda ve AYNI kart deposunda (main.ts gibi), saglayici
 * mock. AddCard(uretilmis kart) -> Charge(card_id) SUCCEEDED; risk 3DS
 * istediyse mock kodla onay. Desteklenmeyen marka sozlesmenin cumlesini alir.
 * Gunlukte numara, parcalari, CVV ve saglayici jetonu YOK.
 */

import { CARD_FIELD_MESSAGES } from '@getir/contracts';
import { ERROR_CODES, fixedClock, GRPC_STATUS, MOCK_THREEDS_CODE } from '@getir/core';
import { recordingLogger, withoutRandomNoise } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { cardvaultV1, paymentV1 } from '@getir/proto';
import { appErrorOf, startTestGrpcServer, unaryCall } from '@getir/service-kit/testing';
import type { CallResult, TestGrpcServer } from '@getir/service-kit/testing';
import type { MethodDefinition } from '@grpc/grpc-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildCardVaultService, buildPaymentService } from '../../src/bootstrap.js';
import { InMemoryCardStore } from '../../src/infrastructure/memory/in-memory-card-store.js';

const Vault = cardvaultV1.CardVaultServiceService;
const Payments = paymentV1.PaymentServiceService;
/** Kullanicinin kart ureticisinden girdigi numara (test karti DEGIL). */
const GENERATED_NUMBER = '4532 4786 1188 4096';
const CVV = '731';

const lines: LogLine[] = [];
const cards = new InMemoryCardStore();
let server: TestGrpcServer;

beforeAll(async () => {
  const clock = fixedClock(Date.parse('2026-10-07T12:00:00Z'));
  const logger = recordingLogger(lines);
  server = await startTestGrpcServer({
    serviceName: 'payment-kart-uretici',
    logger,
    services: [
      buildPaymentService({ cards, clock, logger }),
      buildCardVaultService({ repository: cards, clock, logger }),
    ],
  });
});

afterAll(async () => {
  await server?.stop();
});

/** Gunluk satirlari; hata nesnelerinin mesaji ve yigini da metne girer (pino gibi). */
function serialized(): string {
  return JSON.stringify(lines, (_key, value: unknown) =>
    value instanceof Error ? { message: value.message, stack: value.stack } : value,
  );
}

function call<TRequest, TResponse>(
  method: MethodDefinition<TRequest, TResponse>,
  request: TRequest,
): Promise<CallResult<TResponse>> {
  return unaryCall(server.client, method, request);
}

const addCard = (userId: string, number: string) =>
  call(Vault.addCard, {
    userId,
    number,
    expiryMonth: 12,
    expiryYear: 2031,
    cvv: CVV,
    holderName: 'Kart Sahibi',
    nickname: '',
  });

const charge = (userId: string, orderId: string, cardId: string, requireThreeDs = false) =>
  call(Payments.charge, {
    orderId,
    userId,
    amount: { amountMinor: 12_990, currency: 'TRY' },
    method: paymentV1.PaymentMethod.PAYMENT_METHOD_CARD,
    cardToken: '',
    cardId,
    idempotencyKey: `anahtar-${orderId}`,
    requireThreeDs,
  });

describe('kart uretici numarasi (mock) uctan uca', () => {
  it('kasaya eklenir ve cekilir; risk 3DS isterse mock kodla onaylanir', async () => {
    const added = await addCard('usr_uretici', GENERATED_NUMBER);
    const cardId = added.response?.card?.id ?? '';
    expect(added.error).toBeUndefined();
    expect(added.response?.card).toMatchObject({ last4: '4096' });

    const paid = await charge('usr_uretici', 'ord_uretici-1', cardId);
    expect(paid.response?.payment?.status).toBe(paymentV1.PaymentStatus.PAYMENT_STATUS_SUCCEEDED);

    const challenged = await charge('usr_uretici', 'ord_uretici-2', cardId, true);
    expect(challenged.response?.payment?.status).toBe(
      paymentV1.PaymentStatus.PAYMENT_STATUS_REQUIRES_3DS,
    );
    const confirmed = await call(Payments.confirm3Ds, {
      orderId: 'ord_uretici-2',
      challengeId: challenged.response?.challengeId ?? '',
      code: MOCK_THREEDS_CODE,
    });
    expect(confirmed.response?.payment?.status).toBe(
      paymentV1.PaymentStatus.PAYMENT_STATUS_SUCCEEDED,
    );
  });

  it.each([
    ['Discover', '6011 1111 1111 1117'],
    ['JCB', '3530 1113 3330 0000'],
  ])(
    '%s: INVALID_ARGUMENT, "Bu kart türü desteklenmiyor"; saglayiciya gidilmez',
    async (_name, number) => {
      const { error } = await addCard('usr_marka', number);

      expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
      expect(appErrorOf(error)).toEqual({
        code: ERROR_CODES.VALIDATION_FAILED,
        details: { number: CARD_FIELD_MESSAGES.brand },
      });
    },
  );

  it('gunlukte numara, parcalari, CVV ve saglayici jetonu yok (ekleme ve cekim)', async () => {
    const added = await addCard('usr_gunluk', GENERATED_NUMBER);
    const cardId = added.response?.card?.id ?? '';
    await charge('usr_gunluk', 'ord_gunluk-1', cardId);
    const token = cards.stored(cardId)?.providerToken ?? '';
    expect(token).toMatch(/^tok_[0-9a-f]{32}$/);
    expect(lines.some((line) => line.message === 'kart kaydedildi')).toBe(true);

    // Jeton ham metinde (withoutRandomNoise onu maskelerdi); kisa sirlar maskeli
    // metinde ve rakam sinirlariyla (port gibi rastgele sayilarin parcasi sayilmaz).
    expect(serialized()).not.toContain(token);
    const text = withoutRandomNoise(serialized());
    const digits = GENERATED_NUMBER.replace(/\s/g, '');
    for (const secret of [digits, GENERATED_NUMBER, digits.slice(0, 6), '47861188', CVV]) {
      expect(text).not.toMatch(new RegExp(`(?<![0-9])${secret}(?![0-9])`));
    }
  });
});
