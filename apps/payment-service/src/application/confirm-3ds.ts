/**
 * Confirm3Ds use-case: kullanicinin girdigi 3DS kodunu dogrular (T5.2).
 *
 * Akis: kaydi oku -> sonuclanmissa onceki sonucu ver (ag kaybi tekrari) ->
 * suresi dolmussa kapat -> kodu saglayiciya sor -> sonucu surum kontrollu yaz.
 * Surum cakismasinda (ayni dogrulamaya es zamanli deneme) kayit tekrar okunur
 * ve kural guncel hale uygulanir; saglayiciya ikinci kez GIDILMEZ, cunku kodun
 * dogrulugu kaydin durumuna bagli degildir.
 *
 * Ret sonucu once KAYDA yazilir, sonra THREEDS_FAILED firlatilir: hak dusumu ve
 * kilit hata cevabindan bagimsiz olarak kalicidir.
 */

import { AppError, ERROR_CODES } from '@getir/core';
import type { Clock } from '@getir/core';

import type { Payment } from '../domain/payment.js';
import type { PaymentProvider } from '../domain/payment-provider.js';
import type { PaymentRepository } from '../domain/payment-repository.js';
import {
  applyVerification,
  expireChallenge,
  isChallengeExpired,
  pendingChallenge,
  replayOutcome,
} from '../domain/three-ds.js';
import type { ThreeDsOutcome } from '../domain/three-ds.js';

export interface Confirm3DsDeps {
  readonly repository: PaymentRepository;
  readonly provider: Pick<PaymentProvider, 'verifyChallenge'>;
  readonly clock: Clock;
  readonly maxAttempts: number;
  readonly maxWriteRetries: number;
}

export interface Confirm3DsInput {
  readonly orderId: string;
  readonly challengeId: string;
  readonly code: string;
}

export type Confirm3Ds = (input: Confirm3DsInput) => Promise<Payment>;

/** Hata ayrintisindaki sebep; istemci kullaniciya dogru mesaji secer. */
const WRONG_CODE_REASON = 'wrong_code';

interface Decision {
  readonly outcome: ThreeDsOutcome;
  /** false: kayit zaten bu sonucta (tekrar istek), yazilmaz. */
  readonly persist: boolean;
}

export function createConfirm3Ds(deps: Confirm3DsDeps): Confirm3Ds {
  return async ({ orderId, challengeId, code }) => {
    let verification: Promise<boolean> | undefined;
    const verify = (): Promise<boolean> =>
      (verification ??= verifyCode(deps.provider, challengeId, code));

    for (let attempt = 0; ; attempt += 1) {
      const current = await loadChallengedPayment(deps.repository, orderId, challengeId);
      const { outcome, persist } = await decide(deps, current, verify);
      if (!persist) {
        return finish(outcome);
      }
      try {
        await deps.repository.update(outcome.payment, current.version);
        return finish(outcome);
      } catch (error) {
        if (!isVersionConflict(error) || attempt >= deps.maxWriteRetries) {
          throw error;
        }
      }
    }
  };
}

/** Siparisin odemesi ve bu jeton; ikisi eslesmezse NOT_FOUND (baska siparisin jetonu dahil). */
async function loadChallengedPayment(
  repository: PaymentRepository,
  orderId: string,
  challengeId: string,
): Promise<Payment> {
  const payment = await repository.findByOrderId(orderId);
  if (payment === null || payment.challenge?.id !== challengeId) {
    throw challengeNotFound(orderId);
  }
  return payment;
}

async function decide(
  deps: Confirm3DsDeps,
  payment: Payment,
  verify: () => Promise<boolean>,
): Promise<Decision> {
  const replay = replayOutcome(payment);
  if (replay !== undefined) {
    return { outcome: replay, persist: false };
  }
  const challenge = pendingChallenge(payment);
  if (challenge === undefined) {
    throw challengeNotFound(payment.orderId);
  }
  if (isChallengeExpired(challenge, deps.clock)) {
    return { outcome: expireChallenge(payment, challenge, deps.clock), persist: true };
  }
  const accepted = await verify();
  return {
    outcome: applyVerification(payment, challenge, accepted, deps.maxAttempts, deps.clock),
    persist: true,
  };
}

/** Basari odemeyi doner; ret THREEDS_FAILED olur (kalan hak ve sebep ayrintida). */
function finish(outcome: ThreeDsOutcome): Payment {
  if (outcome.kind === 'succeeded') {
    return outcome.payment;
  }
  throw new AppError(ERROR_CODES.THREEDS_FAILED, '3DS dogrulamasi basarisiz', {
    details: {
      attemptsLeft: outcome.attemptsLeft,
      reason: outcome.closedReason ?? WRONG_CODE_REASON,
    },
  });
}

/** Saglayiciya ulasilamazsa deneme SAYILMAZ, kayit degismez; kullanici tekrar dener. */
async function verifyCode(
  provider: Pick<PaymentProvider, 'verifyChallenge'>,
  challengeId: string,
  code: string,
): Promise<boolean> {
  try {
    return await provider.verifyChallenge({ challengeId, code });
  } catch (error) {
    throw new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, '3DS saglayicisina ulasilamadi', {
      cause: error,
    });
  }
}

function isVersionConflict(error: unknown): boolean {
  return error instanceof AppError && error.code === ERROR_CODES.CONFLICT;
}

function challengeNotFound(orderId: string): AppError {
  return AppError.notFound('3DS dogrulamasi bulunamadi', { details: { orderId } });
}
