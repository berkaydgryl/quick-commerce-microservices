/**
 * Mock odeme saglayicisi: jetona gore karar verir, 3DS'te sabit kodu kabul
 * eder, kart kasasinin 0 TL dogrulamasini (T11.17) test numarasina gore
 * yapar; para hareketi yoktur.
 *
 * Taninmayan jeton ve numara REDDEDILIR: gercek saglayici da bilinmeyen jetonla
 * cekim yapmaz. Hata firlatmak yerine red donmek, kart reddinin "is sonucu"
 * olarak akmasini (FAILED + PAYMENT_DECLINED) korur.
 */

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

/** Test numarasi (yalnizca rakamlar) -> jetonu ve karari. */
const CARD_BY_NUMBER: ReadonlyMap<string, CardVerification> = new Map(
  Object.entries(TEST_CARDS).map(([token, card]) => [
    card.number.replace(/\D/g, ''),
    { decision: card.decision, providerToken: token },
  ]),
);

/** Taninmayan kart: red; jeton yok (reddedilen kart kaydedilmez). */
const UNKNOWN_CARD: CardVerification = { decision: 'DECLINED', providerToken: '' };

export class MockPaymentProvider implements PaymentProvider, CardVerifier {
  authorize({ cardToken }: AuthorizeInput): Promise<ProviderDecision> {
    return Promise.resolve(TEST_CARDS[cardToken]?.decision ?? 'DECLINED');
  }

  /** Mock banka tek bir sabit kod kabul eder (MOCK_THREEDS_CODE). */
  verifyChallenge({ code }: VerifyChallengeInput): Promise<boolean> {
    return Promise.resolve(code === MOCK_THREEDS_CODE);
  }

  /**
   * Test kartinin karari ve jetonu; bilinmeyen numaraya red. Son kullanma ve
   * CVV'ye bakmaz (kurallari kasa denetler).
   */
  verifyCard({ number }: VerifyCardInput): Promise<CardVerification> {
    return Promise.resolve(CARD_BY_NUMBER.get(number) ?? UNKNOWN_CARD);
  }
}
