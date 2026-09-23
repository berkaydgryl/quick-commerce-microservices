/**
 * Mock odeme saglayicisi: jetona gore karar verir, 3DS'te sabit kodu kabul
 * eder; para hareketi yoktur.
 *
 * Taninmayan jeton REDDEDILIR: gercek saglayici da bilinmeyen jetonla cekim
 * yapmaz. Hata firlatmak yerine red donmek, kart reddinin "is sonucu" olarak
 * akmasini (FAILED + PAYMENT_DECLINED) korur.
 */

import { MOCK_THREEDS_CODE } from '@getir/core';

import type {
  AuthorizeInput,
  PaymentProvider,
  ProviderDecision,
  VerifyChallengeInput,
} from '../../domain/payment-provider.js';
import { TEST_CARDS } from './test-cards.js';

export class MockPaymentProvider implements PaymentProvider {
  authorize({ cardToken }: AuthorizeInput): Promise<ProviderDecision> {
    return Promise.resolve(TEST_CARDS[cardToken]?.decision ?? 'DECLINED');
  }

  /** Mock banka tek bir sabit kod kabul eder (MOCK_THREEDS_CODE). */
  verifyChallenge({ code }: VerifyChallengeInput): Promise<boolean> {
    return Promise.resolve(code === MOCK_THREEDS_CODE);
  }
}
