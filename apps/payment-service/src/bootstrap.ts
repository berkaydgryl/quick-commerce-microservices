/**
 * Bagimlilik kurulumu - elle (DI framework yok).
 */

import { systemClock } from '@getir/core';
import type { Clock, Logger } from '@getir/core';
import { paymentV1 } from '@getir/proto';
import type { GrpcServiceRegistration } from '@getir/service-kit';

import { createCharge } from './application/charge.js';
import { PAYMENT_SERVICE_FULL_NAME, THREEDS_CHALLENGE_TTL_MS } from './config/constants.js';
import type { PaymentProvider } from './domain/payment-provider.js';
import type { PaymentRepository } from './domain/payment-repository.js';
import { InMemoryPaymentStore } from './infrastructure/memory/in-memory-payment-store.js';
import { MockPaymentProvider } from './infrastructure/mock-provider/mock-payment-provider.js';
import { createPaymentImplementation } from './interfaces/grpc/payment-handlers.js';

export interface BootstrapOptions {
  readonly logger?: Logger;
  /** Verilmezse bellek (T5.3'e kadar tek depo). */
  readonly repository?: PaymentRepository;
  /** Verilmezse mock saglayici (test kartlari). */
  readonly provider?: PaymentProvider;
  /** Saat; testte sabitlenebilsin diye disaridan verilebilir. */
  readonly clock?: Clock;
}

export function buildPaymentService(options: BootstrapOptions = {}): GrpcServiceRegistration {
  const logger = options.logger;
  const charge = createCharge({
    repository: options.repository ?? new InMemoryPaymentStore(),
    provider: options.provider ?? new MockPaymentProvider(),
    clock: options.clock ?? systemClock,
    challengeTtlMs: THREEDS_CHALLENGE_TTL_MS,
    ...(logger === undefined ? {} : { logger }),
  });

  return {
    name: PAYMENT_SERVICE_FULL_NAME,
    definition: paymentV1.PaymentServiceService,
    implementation: createPaymentImplementation({
      charge,
      ...(logger === undefined ? {} : { logger }),
    }),
  };
}
