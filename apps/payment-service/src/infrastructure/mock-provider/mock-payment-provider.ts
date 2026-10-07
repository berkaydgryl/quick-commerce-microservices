/**
 * Mock odeme saglayicisi: jetona gore karar verir, 3DS'te sabit kodu kabul
 * eder, kart kasasinin 0 TL dogrulamasini (T11.17) yapar; para hareketi yoktur.
 *
 * Kartlar (bekleyen is 112): test kartlari (test-cards.ts) kendi kararini alir
 * (ret, 3DS). Disindaki her kart - kart uretici numaralari - Luhn'u gecerli ve
 * marka desteklenen ise ONAYLANIR ve rastgele bir jeton (tok_<32 onaltilik>) alir;
 * cekimde bu bicimdeki jeton onaylanir. Jeton numaradan turetilmez; numara
 * saklanmaz. Kural durumsuzdur: kasadaki kart, servis yeniden baslasa da cekilir.
 *
 * YALNIZCA MOCK: bu kural ve sinif gercek bir saglayicinin yerine gecmez. Gercek
 * saglayici geldiginde bootstrap onu baglar ve mock HICBIR ortamda baglanmamalidir
 * (aksi halde uretilmis her kart onaylanir). Ortam bayragi bilerek yok.
 *
 * Taninmayan jeton REDDEDILIR: gercek saglayici da bilinmeyen jetonla cekim
 * yapmaz. Hata firlatmak yerine red donmek, kart reddinin "is sonucu" olarak
 * akmasini (FAILED + PAYMENT_DECLINED) korur.
 */

import { randomBytes } from 'node:crypto';

import { cardNumberProblem } from '@getir/contracts';
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

/**
 * Test jetonu -> karari. Map: istemcinin yazdigi jeton ("constructor",
 * "__proto__") nesnenin kalitimsal uyesine denk gelmez.
 */
const DECISION_BY_TOKEN: ReadonlyMap<string, ProviderDecision> = new Map(
  Object.entries(TEST_CARDS).map(([token, card]) => [token, card.decision]),
);

/** Test numarasi (yalnizca rakamlar) -> jetonu ve karari. */
const CARD_BY_NUMBER: ReadonlyMap<string, CardVerification> = new Map(
  Object.entries(TEST_CARDS).map(([token, card]) => [
    card.number.replace(/\D/g, ''),
    { decision: card.decision, providerToken: token },
  ]),
);

/**
 * Uretilmis kartin jetonu: projenin rastgele kimlik bicimi (<onek>_<32
 * onaltilik>, 128 bit). Test jetonlariyla (tok_test_4242) karismaz; test
 * yardimcisi withoutRandomNoise onu rastgele kimlik olarak maskeler.
 */
const GENERATED_TOKEN_PREFIX = 'tok_';
const GENERATED_TOKEN_BYTES = 16;
const GENERATED_TOKEN = new RegExp(
  `^${GENERATED_TOKEN_PREFIX}[0-9a-f]{${GENERATED_TOKEN_BYTES * 2}}$`,
);

/** Taninmayan kart: red; jeton yok (reddedilen kart kaydedilmez). */
const UNKNOWN_CARD: CardVerification = { decision: 'DECLINED', providerToken: '' };

export class MockPaymentProvider implements PaymentProvider, CardVerifier {
  authorize({ cardToken }: AuthorizeInput): Promise<ProviderDecision> {
    const decision =
      DECISION_BY_TOKEN.get(cardToken) ??
      (GENERATED_TOKEN.test(cardToken) ? 'APPROVED' : 'DECLINED');
    return Promise.resolve(decision);
  }

  /** Mock banka tek bir sabit kod kabul eder (MOCK_THREEDS_CODE). */
  verifyChallenge({ code }: VerifyChallengeInput): Promise<boolean> {
    return Promise.resolve(code === MOCK_THREEDS_CODE);
  }

  /**
   * Test karti kendi kararini alir; disindaki kart sozlesmenin numara kuralini
   * (cardNumberProblem: Luhn, marka, hane sayisi) geciyorsa onaylanir (yeni
   * rastgele jeton), gecmiyorsa red. Son kullanma ve CVV'ye bakmaz (kurallari
   * kasa denetler); numara rakamlardan olusur.
   */
  verifyCard({ number }: VerifyCardInput): Promise<CardVerification> {
    const testCard = CARD_BY_NUMBER.get(number);
    if (testCard !== undefined) {
      return Promise.resolve(testCard);
    }
    if (cardNumberProblem(number) !== null) {
      return Promise.resolve(UNKNOWN_CARD);
    }
    return Promise.resolve({ decision: 'APPROVED', providerToken: generatedToken() });
  }
}

function generatedToken(): string {
  return `${GENERATED_TOKEN_PREFIX}${randomBytes(GENERATED_TOKEN_BYTES).toString('hex')}`;
}
