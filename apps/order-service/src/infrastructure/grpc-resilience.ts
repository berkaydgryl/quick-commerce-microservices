/**
 * Order'in gRPC istemcilerinin dayanikliligi (D17): her bagimli servise bir
 * devre kesici, idempotent cagrilara sinirli yeniden deneme. Mekanizma
 * @getir/service-kit'te (circuit-breaker.ts, unary-call.ts); burasi order'in
 * ayarlarini ve "hangi cagri idempotent" kararini istemcilere tasir.
 *
 * Idempotent (yeniden denenebilir) cagrilar istemcide `IDEMPOTENT` ile isaretlenir:
 *   catalog GetMarket, BatchGetOffers (okuma); payment Charge, Refund (anahtarli),
 *   GetPayment (okuma); inventory Reserve, Commit, Release, ShortenReservation
 *   (siparise gore tekrar guvenli) ve ExtendReservation (beklenen bitisle tekrar
 *   guvenli, T15.3); courier AssignCourier, ReleaseCourier (siparise gore tekrar guvenli,
 *   T13.1). Denenmeyenler: risk Evaluate (her cagri yeni bir degerlendirme
 *   kaydi yazar) ve payment Confirm3Ds (tekrar, 3DS hakkini bosa yakabilir).
 */

import type { Logger } from '@getir/core';
import { CircuitBreaker } from '@getir/service-kit';
import type { OutgoingCallOptions, RetryPolicy } from '@getir/service-kit';

import type { RequestScope } from '../application/request-scope.js';
import {
  DEPENDENCY_BREAKER_FAILURE_THRESHOLD,
  DEPENDENCY_BREAKER_OPEN_MS,
  IDEMPOTENT_RETRY_BASE_DELAY_MS,
  IDEMPOTENT_RETRY_MAX,
} from '../config/constants.js';

/** Bagimli servisler: metrik etiketi (kapali liste). */
export const DEPENDENCY = {
  CATALOG: 'catalog',
  RISK: 'risk',
  PAYMENT: 'payment',
  INVENTORY: 'inventory',
  COURIER: 'courier',
} as const;

export type Dependency = (typeof DEPENDENCY)[keyof typeof DEPENDENCY];

/** Istemcinin dayanikliligi; verilmezse yalnizca sure siniri (testler). */
export interface ClientResilience {
  readonly breaker?: CircuitBreaker;
  readonly retry?: RetryPolicy;
}

/** Cagrinin yeniden denenip denenemeyecegi (yukaridaki liste). */
export const IDEMPOTENT = true;
export const NOT_IDEMPOTENT = false;

/** Uretimdeki ayarlarla bir bagimli servisin devre kesicisi ve yeniden deneme politikasi. */
export function dependencyResilience(target: Dependency, logger: Logger): ClientResilience {
  return {
    breaker: new CircuitBreaker({
      target,
      failureThreshold: DEPENDENCY_BREAKER_FAILURE_THRESHOLD,
      openMs: DEPENDENCY_BREAKER_OPEN_MS,
      logger,
    }),
    retry: {
      target,
      maxRetries: IDEMPOTENT_RETRY_MAX,
      baseDelayMs: IDEMPOTENT_RETRY_BASE_DELAY_MS,
    },
  };
}

/** callUnary secenekleri: devre her cagrida, yeniden deneme yalnizca idempotent cagrida. */
export function outgoingOptions(
  scope: RequestScope,
  timeoutMs: number,
  resilience: ClientResilience,
  idempotent: boolean,
): OutgoingCallOptions {
  return {
    requestId: scope.requestId,
    timeoutMs,
    ...(resilience.breaker === undefined ? {} : { breaker: resilience.breaker }),
    ...(idempotent && resilience.retry !== undefined ? { retry: resilience.retry } : {}),
  };
}
