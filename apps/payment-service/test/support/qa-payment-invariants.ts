/**
 * QA PQ1 (T15.2): payment para degismezleri, Mongo belgesi uzerinden. Durum alanina guvenilmez;
 * deneme gecmisiyle (attempts) ve saglayici casusunun sayaciyla karsilastirilir. Her ihlal HANGI
 * siparis ve NEDEN diye tek satir olur; ozellik testi tohumla birlikte yazar.
 *
 *   I1 siparis basina ve anahtar basina en fazla bir kayit (unique indeksler).
 *   I2 her kartli kayitta TAM bir cekim karari; kartli kayitlarin cekim karari sayisi = authorize
 *      cagrisi (saglayiciya anahtar basina bir kez); kapida odemede saglayiciya gidilmez.
 *   I3 durum ile gecmis tutarli (SUCCEEDED, REFUNDED, FAILED, REQUIRES_3DS, CANCELLED, PENDING).
 *   I4 3DS: yanlis kod en fazla 3 ve kayittaki sayacla ayni; en fazla bir kabul.
 *   I5 iade <= cekim ve en fazla bir iade.
 *   I6 iptal komutu islenmis sipariste para kalmaz: SUCCEEDED, REQUIRES_3DS ya da PENDING yok.
 *   I7 belgede saglayici jetonu yok.
 */

import { THREEDS_MAX_ATTEMPTS } from '../../src/config/constants.js';
import { ATTEMPT_KIND, ATTEMPT_OUTCOME } from '../../src/domain/payment.js';
import type { PaymentDocument } from '../../src/infrastructure/mongo/documents.js';
import { moneyOf } from './qa-payment-requests.js';

export interface InvariantContext {
  /** Saglayici casusunun authorize sayaci (kumenin toplami). */
  readonly authorized: number;
  /** Iptal komutu ISLENMIS (onaylanmis) siparisler. */
  readonly cancelled: ReadonlySet<string>;
}

export function violationsOf(
  documents: readonly PaymentDocument[],
  context: InvariantContext,
): string[] {
  const violations: string[] = [];
  violations.push(...duplicates(documents, (document) => document.orderId, 'siparis'));
  violations.push(...duplicates(documents, (document) => document.idempotencyKey, 'anahtar'));
  let chargeDecisions = 0;
  for (const document of documents) {
    const decisions = countOf(document, ATTEMPT_KIND.CHARGE);
    chargeDecisions += decisions;
    for (const problem of problemsOf(document, decisions, context)) {
      violations.push(`${document.orderId} [${document.status}] ${problem}`);
    }
  }
  if (chargeDecisions !== context.authorized) {
    violations.push(
      `I2 cekim karari ${chargeDecisions}, saglayici authorize ${context.authorized}`,
    );
  }
  return violations;
}

function problemsOf(
  document: PaymentDocument,
  decisions: number,
  context: InvariantContext,
): string[] {
  const money = moneyOf(document);
  const problems: string[] = [];
  const fail = (rule: string, ok: boolean) => {
    if (!ok) problems.push(rule);
  };
  const card = document.method === 'CARD';
  fail(`I2 cekim karari ${decisions} (kart: ${String(card)})`, decisions === (card ? 1 : 0));
  fail(`I4 yanlis kod ${money.rejectedCodes}`, money.rejectedCodes <= THREEDS_MAX_ATTEMPTS);
  fail(
    `I4 sayac ${String(document.threeDS?.failedAttempts)} != yanlis kod ${money.rejectedCodes}`,
    (document.threeDS?.failedAttempts ?? 0) === money.rejectedCodes,
  );
  fail(`I4 kabul ${money.acceptedCodes}`, money.acceptedCodes <= 1);
  fail(`I5 iade ${money.refunded} > cekim ${money.charged}`, money.refunded <= money.charged);
  fail(`I5 iade ${money.refunded}`, money.refunded <= 1);
  fail(`I5 cekim ${money.charged}`, money.charged <= 1);
  const status = statusProblem(document, money);
  fail(`I3 ${status}`, status === '');
  if (context.cancelled.has(document.orderId)) {
    fail(
      'I6 iptal edilmis sipariste para ya da acik odeme kaldi',
      !['SUCCEEDED', 'REQUIRES_3DS', 'PENDING'].includes(document.status),
    );
  }
  const stored = JSON.stringify(document);
  fail('I7 belgede jeton', !stored.includes('tok_') && !stored.includes('providerToken'));
  return problems;
}

/** Durumun gecmisle celistigi yer; tutarliysa bos. */
function statusProblem(document: PaymentDocument, money: ReturnType<typeof moneyOf>): string {
  const last = document.attempts.at(-1);
  const lastIs = (kind: string, outcome: string) => last?.kind === kind && last.outcome === outcome;
  switch (document.status) {
    case 'SUCCEEDED':
      return money.charged === 1 &&
        money.refunded === 0 &&
        (lastIs(ATTEMPT_KIND.CHARGE, ATTEMPT_OUTCOME.APPROVED) ||
          lastIs(ATTEMPT_KIND.THREEDS, ATTEMPT_OUTCOME.CODE_ACCEPTED))
        ? ''
        : 'basari gecmisle uyusmuyor';
    case 'REFUNDED':
      return money.charged === 1 && money.refunded === 1 && lastIs(ATTEMPT_KIND.REFUND, 'REFUNDED')
        ? ''
        : 'iade gecmisle uyusmuyor';
    case 'FAILED':
      return money.charged === 0 &&
        (lastIs(ATTEMPT_KIND.CHARGE, ATTEMPT_OUTCOME.DECLINED) ||
          lastIs(ATTEMPT_KIND.CHARGE, ATTEMPT_OUTCOME.PROVIDER_ERROR) ||
          lastIs(ATTEMPT_KIND.THREEDS, ATTEMPT_OUTCOME.EXPIRED) ||
          (money.rejectedCodes === THREEDS_MAX_ATTEMPTS &&
            document.threeDS?.closedReason === 'attempts_exhausted'))
        ? ''
        : 'basarisizlik gecmisle uyusmuyor';
    case 'REQUIRES_3DS':
      return money.charged === 0 &&
        money.rejectedCodes < THREEDS_MAX_ATTEMPTS &&
        document.threeDS !== undefined &&
        document.threeDS.closedReason === undefined
        ? ''
        : '3DS beklemesi gecmisle uyusmuyor';
    case 'CANCELLED':
      return money.charged === 0 && money.cancels === 1 ? '' : 'iptal gecmisle uyusmuyor';
    case 'PENDING':
      // Kartli PENDING ancak karar verilirken olur; tur sonunda yalnizca kapida odeme kalir.
      return document.method === 'CASH_ON_DELIVERY' && document.attempts.length === 0
        ? ''
        : 'PENDING ama kapida odeme degil ya da gecmisi var';
    default:
      return `bilinmeyen durum ${String(document.status)}`;
  }
}

function countOf(document: PaymentDocument, kind: string): number {
  return document.attempts.filter((attempt) => attempt.kind === kind).length;
}

function duplicates(
  documents: readonly PaymentDocument[],
  keyOf: (document: PaymentDocument) => string,
  label: string,
): string[] {
  const seen = new Map<string, number>();
  for (const document of documents) seen.set(keyOf(document), (seen.get(keyOf(document)) ?? 0) + 1);
  return [...seen]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => `I1 ${label} ${key}: ${count} kayit`);
}
