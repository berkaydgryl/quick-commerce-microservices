/**
 * Domain <-> Mongo belgesi cevirisi. Tek yer: alan adi degisirse tek dosya degisir.
 *
 * Istege bagli alanlar (failureCode, threeDS, closedReason) yoksa belgeye HIC
 * yazilmaz: exactOptionalPropertyTypes altinda "alan undefined" ile "alan yok"
 * ayni sey degildir ve geri okunan kayit yazilanla birebir esit olmalidir.
 */

import type { Payment, ThreeDsChallenge } from '../../domain/payment.js';
import type { PaymentDocument, ThreeDsDocument } from './documents.js';

function toThreeDsDocument(challenge: ThreeDsChallenge): ThreeDsDocument {
  const base = {
    challengeId: challenge.id,
    expiresAt: challenge.expiresAt,
    failedAttempts: challenge.failedAttempts,
  };
  return challenge.closedReason === undefined
    ? base
    : { ...base, closedReason: challenge.closedReason };
}

function fromThreeDsDocument(document: ThreeDsDocument): ThreeDsChallenge {
  const base = {
    id: document.challengeId,
    expiresAt: document.expiresAt,
    failedAttempts: document.failedAttempts,
  };
  return document.closedReason === undefined
    ? base
    : { ...base, closedReason: document.closedReason };
}

export function toPaymentDocument(payment: Payment): PaymentDocument {
  return {
    _id: payment.id,
    orderId: payment.orderId,
    userId: payment.userId,
    amount: { amountMinor: payment.amount.amountMinor, currency: payment.amount.currency },
    method: payment.method,
    status: payment.status,
    ...(payment.failureCode === undefined ? {} : { failureCode: payment.failureCode }),
    ...(payment.challenge === undefined ? {} : { threeDS: toThreeDsDocument(payment.challenge) }),
    attempts: payment.attempts.map((attempt) => ({ ...attempt })),
    idempotencyKey: payment.idempotencyKey,
    version: payment.version,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

export function fromPaymentDocument(document: PaymentDocument): Payment {
  return {
    id: document._id,
    orderId: document.orderId,
    userId: document.userId,
    amount: { amountMinor: document.amount.amountMinor, currency: document.amount.currency },
    method: document.method,
    status: document.status,
    ...(document.failureCode === undefined ? {} : { failureCode: document.failureCode }),
    ...(document.threeDS === undefined ? {} : { challenge: fromThreeDsDocument(document.threeDS) }),
    attempts: document.attempts.map((attempt) => ({
      kind: attempt.kind,
      outcome: attempt.outcome,
      at: attempt.at,
    })),
    idempotencyKey: document.idempotencyKey,
    version: document.version,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}
