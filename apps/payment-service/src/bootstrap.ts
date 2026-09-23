/**
 * Bagimlilik kurulumu - elle (DI framework yok).
 */

import { systemClock } from '@getir/core';
import type { Clock, Logger } from '@getir/core';
import { paymentV1 } from '@getir/proto';
import type { GrpcServiceRegistration } from '@getir/service-kit';

import { createCharge } from './application/charge.js';
import { createConfirm3Ds } from './application/confirm-3ds.js';
import {
  CONFIRM_3DS_MAX_WRITE_RETRIES,
  PAYMENT_SERVICE_FULL_NAME,
  THREEDS_CHALLENGE_TTL_MS,
  THREEDS_MAX_ATTEMPTS,
} from './config/constants.js';
import type { PaymentProvider } from './domain/payment-provider.js';
import type { PaymentRepository } from './domain/payment-repository.js';
import { InMemoryPaymentStore } from './infrastructure/memory/in-memory-payment-store.js';
import { MockPaymentProvider } from './infrastructure/mock-provider/mock-payment-provider.js';
import { createPaymentImplementation } from './interfaces/grpc/payment-handlers.js';

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

  const charge = createCharge({
    repository,
    provider,
    clock,
    challengeTtlMs: THREEDS_CHALLENGE_TTL_MS,
    ...(logger === undefined ? {} : { logger }),
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
      ...(logger === undefined ? {} : { logger }),
    }),
  };
}
