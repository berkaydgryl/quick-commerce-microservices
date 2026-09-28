/**
 * Bagimlilik kurulumu - elle (DI framework yok).
 */

import { EVENTS, systemClock } from '@getir/core';
import type { Clock, Logger } from '@getir/core';
import type { EventSubscriber } from '@getir/event-bus';
import { paymentV1 } from '@getir/proto';
import type { GrpcServiceRegistration } from '@getir/service-kit';

import { createCharge } from './application/charge.js';
import { createConfirm3Ds } from './application/confirm-3ds.js';
import { createRefund } from './application/refund.js';
import {
  CONFIRM_3DS_MAX_WRITE_RETRIES,
  EVENT_CONSUMER_GROUP,
  PAYMENT_SERVICE_FULL_NAME,
  THREEDS_CHALLENGE_TTL_MS,
  THREEDS_MAX_ATTEMPTS,
} from './config/constants.js';
import type { PaymentProvider } from './domain/payment-provider.js';
import type { PaymentRepository } from './domain/payment-repository.js';
import { InMemoryPaymentStore } from './infrastructure/memory/in-memory-payment-store.js';
import { MockPaymentProvider } from './infrastructure/mock-provider/mock-payment-provider.js';
import { createPaymentImplementation } from './interfaces/grpc/payment-handlers.js';
import { createRefundRequestedHandler } from './interfaces/workers/refund-requested.js';

export interface BootstrapOptions {
  readonly logger?: Logger;
  /** Odeme deposu; main.ts openPaymentStore'dan verir. Verilmezse bellek (testler). */
  readonly repository?: PaymentRepository;
  /** Verilmezse mock saglayici (test kartlari). */
  readonly provider?: PaymentProvider;
  /** Saat; testte sabitlenebilsin diye disaridan verilebilir. */
  readonly clock?: Clock;
}

export function buildPaymentService(options: BootstrapOptions = {}): GrpcServiceRegistration {
  const logger = options.logger;
  // Iki use-case AYNI depoyu ve saglayiciyi paylasir: Charge'in actigi
  // dogrulamayi Confirm3Ds ayni kayitta bulur.
  const repository = options.repository ?? new InMemoryPaymentStore();
  const provider = options.provider ?? new MockPaymentProvider();
  const clock = options.clock ?? systemClock;

  // Use-case'ler gunlukcuyu bagimlilik olarak ALMAZ: her cagrida handler'in
  // requestId bagli gunlukcusu gecer (ctx.logger).
  const charge = createCharge({
    repository,
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
      ...(logger === undefined ? {} : { logger }),
    }),
  };
}

export interface PaymentEventOptions {
  /** gRPC servisiyle AYNI depo: iade komutu, Refund RPC'sinin gordugu kaydi iade eder. */
  readonly repository: PaymentRepository;
  readonly clock?: Clock;
}

/**
 * Olay dinleme kayitlari (T7.4): payment.refund_requested -> Refund use-case.
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
}
