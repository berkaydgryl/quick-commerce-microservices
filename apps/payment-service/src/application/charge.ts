/**
 * Charge use-case: siparis tutarini ceker.
 *
 * Akis: (1) ayni anahtarla gelen tekrar istek ilk kaydi doner, (2) siparisin
 * baska bir odemesi varsa CONFLICT, (3) PENDING kayit yazilir - siparisi ve
 * anahtari SAHIPLENIR, (4) kartsa saglayiciya gidilir, (5) karar kayda islenir.
 *
 * Kayit saglayicidan ONCE yazildigi icin ayni anahtarla es zamanli iki istekte
 * ikincisi insert'te CONFLICT alir, tekrar-istek yoluna duser ve saglayiciya
 * HIC gitmez: cift cekim olmaz.
 */

import { AppError } from '@getir/core';
import type { Clock, Logger } from '@getir/core';

import {
  failUnreachableProvider,
  isSameCharge,
  PAYMENT_METHOD,
  settlePayment,
  startPayment,
} from '../domain/payment.js';
import type { ChargeCommand, Payment } from '../domain/payment.js';
import type { PaymentProvider } from '../domain/payment-provider.js';
import type { PaymentRepository } from '../domain/payment-repository.js';
import { paymentAlreadyExists } from '../domain/payment-repository.js';

export interface ChargeDeps {
  readonly repository: PaymentRepository;
  /** Yalnizca cekim karari; 3DS dogrulamasi bu use-case'in isi degil. */
  readonly provider: Pick<PaymentProvider, 'authorize'>;
  readonly clock: Clock;
  readonly challengeTtlMs: number;
  readonly logger?: Logger;
}

export interface ChargeInput extends ChargeCommand {
  /** Kartli odemede zorunlu, kapida odemede bos (sema dogrular). */
  readonly cardToken: string | undefined;
}

export type Charge = (input: ChargeInput) => Promise<Payment>;

export function createCharge(deps: ChargeDeps): Charge {
  return async ({ cardToken, ...command }) => {
    const replay = await findReplay(deps.repository, command);
    if (replay !== null) {
      return replay;
    }
    if ((await deps.repository.findByOrderId(command.orderId)) !== null) {
      throw paymentAlreadyExists(command.orderId);
    }

    const pending = startPayment(command, deps.clock);
    try {
      await deps.repository.insert(pending);
    } catch (error) {
      // Es zamanli ayni anahtar: kazanan kaydi yazdi, kaybeden onu doner.
      const winner = await findReplay(deps.repository, command);
      if (winner !== null) {
        return winner;
      }
      throw error;
    }

    // Kapida odemede saglayiciya gidilmez: tutar teslimatta alinir. (Kartli
    // odemede jetonun varligini sema garanti eder; ikinci kosul tip daraltmadir.)
    if (command.method === PAYMENT_METHOD.CASH_ON_DELIVERY || cardToken === undefined) {
      return pending;
    }
    const settled = await authorizeAndSettle(deps, pending, cardToken);
    await deps.repository.update(settled, pending.version);
    return settled;
  };
}

/** Ayni anahtarli kayit: ayni niyetse onu doner, farkli govdeyse CONFLICT. */
async function findReplay(
  repository: PaymentRepository,
  command: ChargeCommand,
): Promise<Payment | null> {
  const existing = await repository.findByIdempotencyKey(command.idempotencyKey);
  if (existing === null) {
    return null;
  }
  if (!isSameCharge(existing, command)) {
    throw AppError.conflict('Ayni Idempotency-Key farkli bir govde ile kullanildi', {
      details: { idempotencyKey: command.idempotencyKey },
    });
  }
  return existing;
}

async function authorizeAndSettle(
  deps: ChargeDeps,
  pending: Payment,
  cardToken: string,
): Promise<Payment> {
  try {
    const decision = await deps.provider.authorize({ cardToken, amount: pending.amount });
    return settlePayment(pending, decision, deps.clock, deps.challengeTtlMs);
  } catch (error) {
    // Hata istemciye degil gunluge: tutar cekilmedi, kayit FAILED olur.
    deps.logger?.error({ err: error, orderId: pending.orderId }, 'odeme saglayicisina ulasilamadi');
    return failUnreachableProvider(pending, deps.clock);
  }
}
