/**
 * Use-case: 3DS onayi (T7.1) - kodu payment-svc'ye iletir, sonucu siparise isler.
 *
 *  - Kod dogru          -> PAID (PAID yazilamazsa iade telafisi, payment-step.ts)
 *  - Yanlis kod, hak var -> THREEDS_FAILED (kalan hak ayrintida); siparis bekler
 *  - Hak bitti / sure doldu -> siparis PAYMENT_FAILED, sonra THREEDS_FAILED
 *
 * TEKRAR ISTEK: siparis zaten PAID ise (onay cevabi kaybolmus) ayni sonuc
 * doner, payment-svc'ye gidilmez.
 *
 * KILIT SURESI (T11.3): her onay denemesinden ONCE kalan sure kisaysa kilit
 * uzatilir; kilit dusmusse kod payment-svc'ye gitmez, siparis CANCELLED + 410
 * (lock-timing.ts; payment.cancel_requested 3DS bekleyen odemeyi kapatir).
 */

import { AppError, ERROR_CODES, ORDER_STATUS } from '@getir/core';
import { z } from 'zod';

import { PAYMENT_METHOD } from '../domain/checkout-payment.js';
import type { PaymentResult } from '../domain/checkout-payment.js';
import type { OrderOutbox } from '../domain/order-outbox.js';
import type { OrderRepository } from '../domain/order-repository.js';
import { assertTransition } from '../domain/order-state-machine.js';
import type { Order } from '../domain/order.js';
import { securePaymentWindow } from './lock-timing.js';
import type { LockTimingDeps } from './lock-timing.js';
import { findOwnOrder } from './own-order.js';
import { failPayment, settleOrderPayment } from './payment-step.js';
import type { Payments } from './payments.js';
import type { RequestScope } from './request-scope.js';

export interface ConfirmPaymentDeps extends LockTimingDeps {
  readonly repository: Pick<OrderRepository, 'findById' | 'update'>;
  readonly payments: Payments;
  /** Telafi komutu icin (payment-step.ts). */
  readonly outbox: Pick<OrderOutbox, 'append'>;
}

export interface ConfirmPaymentInput {
  readonly orderId: string;
  readonly userId: string;
  readonly challengeId: string;
  readonly code: string;
}

export type ConfirmPayment = (input: ConfirmPaymentInput, scope: RequestScope) => Promise<Order>;

/** payment-svc'nin THREEDS_FAILED ayrintisi: kalan hak 0 ise dogrulama kapanmistir. */
const closedChallengeDetails = z.object({ attemptsLeft: z.literal(0) });

export function createConfirmPayment(deps: ConfirmPaymentDeps): ConfirmPayment {
  return async ({ orderId, userId, challengeId, code }, scope) => {
    const order = await findOwnOrder(deps.repository, orderId, userId);
    if (order.status === ORDER_STATUS.PAID) {
      return order;
    }
    assertTransition(order.id, order.status, ORDER_STATUS.PAID);
    const windowed = await securePaymentWindow(deps, order, scope);

    let result: PaymentResult;
    try {
      result = await deps.payments.confirmThreeDs({ orderId, challengeId, code }, scope);
    } catch (error) {
      if (isClosedChallenge(error)) {
        // Siparis PAYMENT_FAILED yazilir; istemci payment-svc'nin hatasini
        // (kalan hak 0, sebep: expired / attempts_exhausted) aynen gorur.
        await failPayment(deps, windowed, ERROR_CODES.THREEDS_FAILED, scope);
      }
      throw error;
    }

    // 3DS yalnizca kartli odemede vardir.
    return (await settleOrderPayment(deps, windowed, PAYMENT_METHOD.CARD, result, scope)).order;
  };
}

function isClosedChallenge(error: unknown): boolean {
  return (
    error instanceof AppError &&
    error.code === ERROR_CODES.THREEDS_FAILED &&
    closedChallengeDetails.safeParse(error.details).success
  );
}
