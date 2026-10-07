/**
 * Kayitli kartla cekim (T12.4; B1): Charge(card_id). Kart, cekim kaydi
 * yazilmadan ONCE kasada aranir (charge-card.ts): kart yoksa, silinmisse ya da
 * baskasininsa NOT_FOUND (ayrinti yalnizca resource "card"), kayit YAZILMAZ ve
 * idempotency anahtari harcanmaz. Saglayici jetonu yalnizca bellekte: cevaba,
 * gunluge ve kayda girmez; kayitta yalnizca kartin kimligi.
 */

import { AppError, ERROR_CODES, fixedClock, ID_PREFIX, newId } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCharge } from '../../src/application/charge.js';
import type { ChargeInput } from '../../src/application/charge.js';
import { THREEDS_CHALLENGE_TTL_MS } from '../../src/config/constants.js';
import { CARD_STATUS } from '../../src/domain/card.js';
import type { Card } from '../../src/domain/card.js';
import { PAYMENT_METHOD, PAYMENT_STATUS } from '../../src/domain/payment.js';
import type { PaymentProvider } from '../../src/domain/payment-provider.js';
import { InMemoryCardStore } from '../../src/infrastructure/memory/in-memory-card-store.js';
import { InMemoryPaymentStore } from '../../src/infrastructure/memory/in-memory-payment-store.js';
import { MockPaymentProvider } from '../../src/infrastructure/mock-provider/mock-payment-provider.js';
import { toProtoChargeResponse } from '../../src/interfaces/grpc/mappers.js';

const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
const clock = fixedClock(NOW);
const OWNER = 'usr_kart-sahibi';
const TOKEN = 'tok_test_4242';
const CHALLENGE_TOKEN = 'tok_test_3184';

let cards: InMemoryCardStore;
let payments: InMemoryPaymentStore;
let lines: LogLine[];

beforeEach(() => {
  cards = new InMemoryCardStore();
  payments = new InMemoryPaymentStore();
  lines = [];
});

async function savedCard(userId = OWNER, providerToken = TOKEN): Promise<Card> {
  const card: Card = {
    id: newId(ID_PREFIX.CARD),
    userId,
    brand: 'VISA',
    first4: providerToken.slice(-4),
    last4: providerToken.slice(-4),
    expiryMonth: 12,
    expiryYear: 2031,
    holderName: 'Ayşe Yılmaz',
    providerToken,
    status: CARD_STATUS.ACTIVE,
    createdAt: new Date(NOW),
  };
  await cards.add(card, 10);
  return card;
}

function charge(provider: Pick<PaymentProvider, 'authorize'> = new MockPaymentProvider()) {
  const useCase = createCharge({
    repository: payments,
    cards,
    provider,
    clock,
    challengeTtlMs: THREEDS_CHALLENGE_TTL_MS,
  });
  return (input: ChargeInput) => useCase(input, recordingLogger(lines));
}

const request = (cardId: string, orderId = 'ord_kayitli-kart-1'): ChargeInput => ({
  orderId,
  userId: OWNER,
  amount: { amountMinor: 12_990, currency: 'TRY' },
  method: PAYMENT_METHOD.CARD,
  idempotencyKey: `anahtar-${orderId}`,
  requireThreeDs: false,
  card: { cardId },
});

async function rejectionOf(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (error instanceof AppError) return error;
  throw new Error('AppError beklenirdi');
}

/** Jeton ve "providerToken" adi hicbir yerde olmamali (gunluk satirlari, kayit, cevap). */
function expectNoToken(value: unknown): void {
  const text = JSON.stringify(value);
  expect(text).not.toContain('tok_');
  expect(text).not.toContain('providerToken');
}

describe('Charge(card_id): kasadaki kartla odeme', () => {
  it('kartin jetonuyla cekilir; kayitta yalnizca kartin kimligi, jeton YOK', async () => {
    const card = await savedCard();

    const payment = await charge()(request(card.id));

    expect(payment).toMatchObject({ status: PAYMENT_STATUS.SUCCEEDED, cardId: card.id });
    expectNoToken(await payments.findByOrderId(payment.orderId));
    expectNoToken(toProtoChargeResponse(payment));
    expectNoToken(lines);
  });

  it.each([
    [
      'silinmis',
      async () => {
        const card = await savedCard();
        await cards.softDelete(OWNER, card.id, new Date(NOW));
        return card.id;
      },
    ],
    ['baska kullanicinin', async () => (await savedCard('usr_baskasi')).id],
    ['hic olmayan', () => Promise.resolve(newId(ID_PREFIX.CARD))],
  ])(
    '%s kart: NOT_FOUND, ayrintida yalnizca resource "card"; kayit YAZILMAZ, anahtar harcanmaz',
    async (_name, cardIdOf) => {
      const cardId = await cardIdOf();

      const error = await rejectionOf(charge()(request(cardId)));

      expect(error.code).toBe(ERROR_CODES.NOT_FOUND);
      expect(error.details).toEqual({ resource: 'card' });
      expect(JSON.stringify(error)).not.toContain(cardId);
      expect(await payments.findByOrderId('ord_kayitli-kart-1')).toBeNull();

      // Ayni siparis, AYNI anahtar, gecerli kart: cekim yapilir (anahtar harcanmamis).
      const valid = await savedCard(OWNER, 'tok_test_4444');
      await expect(charge()(request(valid.id))).resolves.toMatchObject({
        status: PAYMENT_STATUS.SUCCEEDED,
        cardId: valid.id,
      });
      expectNoToken(lines);
    },
  );

  it('kart arama ile cekim arasinda silinirse cekim okunan jetonla SURER; sonraki odeme NOT_FOUND', async () => {
    const card = await savedCard();
    const provider = new MockPaymentProvider();
    const racing: Pick<PaymentProvider, 'authorize'> = {
      authorize: async (input) => {
        // Kullanici baska sekmede karti tam bu anda siler.
        await cards.softDelete(OWNER, card.id, new Date(NOW));
        return provider.authorize(input);
      },
    };

    const payment = await charge(racing)(request(card.id));

    expect(payment.status).toBe(PAYMENT_STATUS.SUCCEEDED);
    expect(cards.stored(card.id)).toMatchObject({ status: CARD_STATUS.DELETED });
    expect(cards.stored(card.id)?.providerToken).toBeUndefined();
    const next = await rejectionOf(charge()(request(card.id, 'ord_kayitli-kart-2')));
    expect(next.code).toBe(ERROR_CODES.NOT_FOUND);
  });

  it('ayni anahtarla tekrar: kart sonradan silinmis olsa da ILK kayit doner, kart ARANMAZ', async () => {
    const card = await savedCard();
    const first = await charge()(request(card.id));
    await cards.softDelete(OWNER, card.id, new Date(NOW));
    const lookups = vi.spyOn(cards, 'findActive');

    await expect(charge()(request(card.id))).resolves.toEqual(first);
    expect(lookups).not.toHaveBeenCalled();
  });

  it('saglayiciya ulasilamazsa hata satirinda jeton maskelenir (saglayici metni yankilasa da)', async () => {
    const card = await savedCard();
    const failing: Pick<PaymentProvider, 'authorize'> = {
      authorize: (input) => Promise.reject(new Error(`baglanti koptu: ${input.cardToken}`)),
    };

    const payment = await charge(failing)(request(card.id));

    expect(payment.status).toBe(PAYMENT_STATUS.FAILED);
    // pino'nun err serilestiricisi mesaji ve yigini yazar: ikisi de jetonsuz olmali.
    const logged = lines.find((line) => line.level === 'error')?.fields.err;
    expect(logged).toBeInstanceOf(Error);
    const { message, stack } = logged as Error;
    expect(message).toBe('baglanti koptu: [jeton]');
    expect(stack ?? '').not.toContain('tok_');
    expectNoToken(lines);
  });

  it('3DS: cevaptaki bitis kayittaki an (cekim + 3DS omru); 3DS yoksa alan yok', async () => {
    const challenged = await savedCard(OWNER, CHALLENGE_TOKEN);

    const payment = await charge()(request(challenged.id));
    const response = toProtoChargeResponse(payment);

    expect(payment.status).toBe(PAYMENT_STATUS.REQUIRES_3DS);
    expect(response.challengeExpiresAt).toEqual(new Date(NOW + THREEDS_CHALLENGE_TTL_MS));
    expect(response.challengeExpiresAt).toEqual(payment.challenge?.expiresAt);
    const plain = await charge()(request((await savedCard(OWNER, 'tok_test_4444')).id, 'ord_2'));
    expect(toProtoChargeResponse(plain).challengeExpiresAt).toBeUndefined();
  });
});
