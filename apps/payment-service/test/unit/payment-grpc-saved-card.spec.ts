/**
 * Kayitli kartla odeme uctan uca, gRPC (T12.4; B1): kart kasasi ve odeme
 * servisi AYNI sunucuda ve AYNI kart deposunda (main.ts gibi). AddCard ->
 * Charge(card_id) -> DeleteCard -> Charge(card_id) NOT_FOUND; card_id ile
 * card_token birlikte VALIDATION_FAILED. Hicbir cevapta saglayici jetonu yok.
 */

import { ERROR_CODES, fixedClock, GRPC_STATUS } from '@getir/core';
import { cardvaultV1, paymentV1 } from '@getir/proto';
import { appErrorOf, startTestGrpcServer, unaryCall } from '@getir/service-kit/testing';
import type { CallResult, TestGrpcServer } from '@getir/service-kit/testing';
import type { MethodDefinition } from '@grpc/grpc-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildCardVaultService, buildPaymentService } from '../../src/bootstrap.js';
import { InMemoryCardStore } from '../../src/infrastructure/memory/in-memory-card-store.js';

const NOW_MS = Date.parse('2026-10-07T12:00:00Z');
const Vault = cardvaultV1.CardVaultServiceService;
const Payments = paymentV1.PaymentServiceService;
const OWNER = 'usr_grpc-kart-odeme';

let server: TestGrpcServer;

beforeAll(async () => {
  const cards = new InMemoryCardStore();
  const clock = fixedClock(NOW_MS);
  server = await startTestGrpcServer({
    serviceName: 'payment-kayitli-kart',
    services: [
      buildPaymentService({ cards, clock }),
      buildCardVaultService({ repository: cards, clock }),
    ],
  });
});

afterAll(async () => {
  await server?.stop();
});

function call<TRequest, TResponse>(
  method: MethodDefinition<TRequest, TResponse>,
  request: TRequest,
): Promise<CallResult<TResponse>> {
  return unaryCall(server.client, method, request);
}

async function addCard(userId = OWNER): Promise<string> {
  const { response } = await call(Vault.addCard, {
    userId,
    number: '4242 4242 4242 4242',
    expiryMonth: 12,
    expiryYear: 2031,
    cvv: '987',
    holderName: 'Ayşe Yılmaz',
    nickname: '',
  });
  const cardId = response?.card?.id ?? '';
  expect(cardId).toMatch(/^crd_/);
  return cardId;
}

const charge = (orderId: string, card: { cardId?: string; cardToken?: string }, userId = OWNER) =>
  call(Payments.charge, {
    orderId,
    userId,
    amount: { amountMinor: 12_990, currency: 'TRY' },
    method: paymentV1.PaymentMethod.PAYMENT_METHOD_CARD,
    cardToken: card.cardToken ?? '',
    cardId: card.cardId ?? '',
    idempotencyKey: `anahtar-${orderId}`,
    requireThreeDs: false,
  });

describe('Charge(card_id) gRPC', () => {
  it('kasadaki kartla cekilir; silinince ayni kart NOT_FOUND, ayrintida yalnizca resource "card"', async () => {
    const cardId = await addCard();

    const paid = await charge('ord_grpc-kart-1', { cardId });
    expect(paid.response?.payment?.status).toBe(paymentV1.PaymentStatus.PAYMENT_STATUS_SUCCEEDED);
    expect(JSON.stringify(paid.response)).not.toContain('tok_');

    await call(Vault.deleteCard, { userId: OWNER, cardId });
    const gone = await charge('ord_grpc-kart-2', { cardId });

    expect(gone.error?.code).toBe(GRPC_STATUS.NOT_FOUND);
    expect(appErrorOf(gone.error)).toEqual({
      code: ERROR_CODES.NOT_FOUND,
      details: { resource: 'card' },
    });
  });

  it('card_id ile card_token birlikte: VALIDATION_FAILED', async () => {
    // Kendi kullanicisi: onceki testin kartina bagli kalmaz.
    const userId = 'usr_grpc-kart-ikisi';
    const cardId = await addCard(userId);

    const both = await charge('ord_grpc-kart-3', { cardId, cardToken: 'tok_test_4242' }, userId);

    expect(both.error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(appErrorOf(both.error)?.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });
});
