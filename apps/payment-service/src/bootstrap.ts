/**
 * Bagimlilik kurulumu - elle (DI framework yok).
 */

import { SAVED_CARDS_MAX } from '@getir/contracts';
import { EVENTS, systemClock } from '@getir/core';
import type { Clock, Logger } from '@getir/core';
import type { EventSubscriber } from '@getir/event-bus';
import { cardvaultV1, paymentV1 } from '@getir/proto';
import type { GrpcServiceRegistration } from '@getir/service-kit';

import { createAddCard } from './application/add-card.js';
import { createCancelPayment } from './application/cancel-payment.js';
import { createCharge } from './application/charge.js';
import { createConfirm3Ds } from './application/confirm-3ds.js';
import { createDeleteCard } from './application/delete-card.js';
import { createGetPayment } from './application/get-payment.js';
import { createListCards } from './application/list-cards.js';
import { createRefund } from './application/refund.js';
import { createUpdateCardNickname } from './application/update-card-nickname.js';
import {
  CARD_VAULT_SERVICE_FULL_NAME,
  CONFIRM_3DS_MAX_WRITE_RETRIES,
  EVENT_CONSUMER_GROUP,
  PAYMENT_SERVICE_FULL_NAME,
  THREEDS_CHALLENGE_TTL_MS,
  THREEDS_MAX_ATTEMPTS,
} from './config/constants.js';
import type { CardRepository } from './domain/card-repository.js';
import type { CardVerifier } from './domain/card-verifier.js';
import type { PaymentProvider } from './domain/payment-provider.js';
import type { PaymentRepository } from './domain/payment-repository.js';
import { InMemoryCardStore } from './infrastructure/memory/in-memory-card-store.js';
import { InMemoryPaymentStore } from './infrastructure/memory/in-memory-payment-store.js';
import { MockPaymentProvider } from './infrastructure/mock-provider/mock-payment-provider.js';
import { createCardVaultImplementation } from './interfaces/grpc/card-vault-handlers.js';
import { createPaymentImplementation } from './interfaces/grpc/payment-handlers.js';
import { createCancelRequestedHandler } from './interfaces/workers/cancel-requested.js';
import { createRefundRequestedHandler } from './interfaces/workers/refund-requested.js';

export interface BootstrapOptions {
  readonly logger?: Logger;
  /** Odeme deposu; main.ts openPaymentStore'dan verir. Verilmezse bellek (testler). */
  readonly repository?: PaymentRepository;
  /** Verilmezse mock saglayici (test kartlari). */
  readonly provider?: PaymentProvider;
  /**
   * Kayitli kartla odeme (T12.4): kart kasasinin deposu; kart kasasi servisiyle
   * AYNI depo verilmeli (main.ts). Verilmezse bellek (testler).
   */
  readonly cards?: CardRepository;
  /** Saat; testte sabitlenebilsin diye disaridan verilebilir. */
  readonly clock?: Clock;
}

export function buildPaymentService(options: BootstrapOptions = {}): GrpcServiceRegistration {
  const logger = options.logger;
  // Iki use-case AYNI depoyu ve saglayiciyi paylasir: Charge'in actigi
  // dogrulamayi Confirm3Ds ayni kayitta bulur.
  const repository = options.repository ?? new InMemoryPaymentStore();
  // YALNIZCA MOCK (bekleyen is 112): mock uretilmis her Luhn kartini onaylar.
  // Gercek saglayici geldiginde burada o baglanir; mock HICBIR ortamda kalmamali.
  const provider = options.provider ?? new MockPaymentProvider();
  const clock = options.clock ?? systemClock;

  // Use-case'ler gunlukcuyu bagimlilik olarak ALMAZ: her cagrida handler'in
  // requestId bagli gunlukcusu gecer (ctx.logger).
  const charge = createCharge({
    repository,
    cards: options.cards ?? new InMemoryCardStore(),
    provider,
    clock,
    challengeTtlMs: THREEDS_CHALLENGE_TTL_MS,
  });
  const confirm3Ds = createConfirm3Ds({
    repository,
    provider,
    clock,
    maxAttempts: THREEDS_MAX_ATTEMPTS,
    maxWriteRetries: CONFIRM_3DS_MAX_WRITE_RETRIES,
  });

  return {
    name: PAYMENT_SERVICE_FULL_NAME,
    definition: paymentV1.PaymentServiceService,
    implementation: createPaymentImplementation({
      charge,
      confirm3Ds,
      refund: createRefund({ repository, clock }),
      getPayment: createGetPayment({ repository }),
      ...(logger === undefined ? {} : { logger }),
    }),
  };
}

export interface CardVaultOptions {
  readonly logger?: Logger;
  /** Kart kasasinin deposu; main.ts openPaymentStore'dan verir. Verilmezse bellek (testler). */
  readonly repository?: CardRepository;
  /** Verilmezse mock saglayici (test kartlari). */
  readonly verifier?: CardVerifier;
  readonly clock?: Clock;
}

/**
 * Kart kasasi (T11.17): odeme servisiyle ayni sunucuda ikinci gRPC servisi.
 * Kart numarasi yalnizca AddCard'da ve saglayicinin dogrulamasina kadar yasar.
 */
export function buildCardVaultService(options: CardVaultOptions = {}): GrpcServiceRegistration {
  const repository = options.repository ?? new InMemoryCardStore();
  // YALNIZCA MOCK: kart dogrulamasi da mock'ta (yukaridaki uyari).
  const verifier = options.verifier ?? new MockPaymentProvider();
  const clock = options.clock ?? systemClock;

  return {
    name: CARD_VAULT_SERVICE_FULL_NAME,
    definition: cardvaultV1.CardVaultServiceService,
    implementation: createCardVaultImplementation({
      addCard: createAddCard({ repository, verifier, clock, maxCards: SAVED_CARDS_MAX }),
      listCards: createListCards({ repository }),
      deleteCard: createDeleteCard({ repository, clock }),
      updateCardNickname: createUpdateCardNickname({ repository }),
      clock,
      ...(options.logger === undefined ? {} : { logger: options.logger }),
    }),
  };
}

export interface PaymentEventOptions {
  /** gRPC servisiyle AYNI depo: iade komutu, Refund RPC'sinin gordugu kaydi iade eder. */
  readonly repository: PaymentRepository;
  readonly clock?: Clock;
}

/**
 * Olay dinleme kayitlari: payment.refund_requested -> Refund use-case (T7.4),
 * payment.cancel_requested -> CancelPayment use-case (T11.2 PR 3).
 * Dinlemeyi baslatmak (start) ve durdurmak main.ts'in isidir; burada yalnizca
 * hangi konunun hangi isleyiciye gidecegi baglanir.
 */
export function subscribePaymentEvents(
  subscriber: EventSubscriber,
  options: PaymentEventOptions,
): void {
  subscriber.subscribe(
    EVENTS.PAYMENT_REFUND_REQUESTED,
    EVENT_CONSUMER_GROUP,
    createRefundRequestedHandler({
      refund: createRefund({ repository: options.repository, clock: options.clock ?? systemClock }),
    }),
  );
  subscriber.subscribe(
    EVENTS.PAYMENT_CANCEL_REQUESTED,
    EVENT_CONSUMER_GROUP,
    createCancelRequestedHandler({
      cancel: createCancelPayment({
        repository: options.repository,
        clock: options.clock ?? systemClock,
        refund: createRefund({
          repository: options.repository,
          clock: options.clock ?? systemClock,
        }),
      }),
    }),
  );
}
