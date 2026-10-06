/**
 * Mock odeme saglayicisi: jetona gore karar verir, 3DS'te sabit kodu kabul
 * eder, kart kasasinin 0 TL dogrulamasini (T11.17) test numarasina gore
 * yapar; para hareketi yoktur.
 *
 * Taninmayan jeton ve numara REDDEDILIR: gercek saglayici da bilinmeyen jetonla
 * cekim yapmaz. Hata firlatmak yerine red donmek, kart reddinin "is sonucu"
 * olarak akmasini (FAILED + PAYMENT_DECLINED) korur.
 */

import { randomUUID } from 'node:crypto';

import { MOCK_THREEDS_CODE } from '@getir/core';

import type {
  CardVerification,
  CardVerifier,
  VerifyCardInput,
} from '../../domain/card-verifier.js';
import type {
  AuthorizeInput,
  PaymentProvider,
  ProviderDecision,
  VerifyChallengeInput,
} from '../../domain/payment-provider.js';
import { TEST_CARDS } from './test-cards.js';

/** Test numarasi (yalnizca rakamlar) -> jetonu. */
const TOKEN_BY_NUMBER: ReadonlyMap<string, string> = new Map(
  Object.entries(TEST_CARDS).map(([token, card]) => [card.number.replace(/\D/g, ''), token]),
);

export class MockPaymentProvider implements PaymentProvider, CardVerifier {
  authorize({ cardToken }: AuthorizeInput): Promise<ProviderDecision> {
    return Promise.resolve(TEST_CARDS[cardToken]?.decision ?? 'DECLINED');
  }

  /** Mock banka tek bir sabit kod kabul eder (MOCK_THREEDS_CODE). */
  verifyChallenge({ code }: VerifyChallengeInput): Promise<boolean> {
    return Promise.resolve(code === MOCK_THREEDS_CODE);
  }

  /**
   * Test kartinin karari ve jetonu; bilinmeyen numaraya rastgele jeton ve red.
   * Son kullanma ve CVV'ye bakmaz (kurallari kasa denetler).
   */
  verifyCard({ number }: VerifyCardInput): Promise<CardVerification> {
    const token = TOKEN_BY_NUMBER.get(number);
    const decision = token === undefined ? undefined : TEST_CARDS[token]?.decision;
    if (token === undefined || decision === undefined) {
      return Promise.resolve({
        decision: 'DECLINED',
        providerToken: `tok_${randomUUID().replace(/-/g, '')}`,
      });
    }
    return Promise.resolve({ decision, providerToken: token });
  }
}
