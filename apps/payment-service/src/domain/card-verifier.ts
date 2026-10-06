/**
 * Kart dogrulama portu (T11.17): kart kasaya eklenmeden once saglayiciya 0 TL
 * dogrulatilir. Ham kart numarasinin ve CVV'nin gectigi TEK sinir budur:
 * saglayici karti dogrular ve bir jeton doner; numara burada biter.
 *
 * Cekim portundan (PaymentProvider) ayridir: cekim jetonla calisir, numara
 * gormez. Mock saglayici ikisini de uygular.
 */

import type { ProviderDecision } from './payment-provider.js';

export interface VerifyCardInput {
  /** Yalnizca rakamlar (bosluk ve tire atilmis). Gunluge YAZILMAZ. */
  readonly number: string;
  readonly expiryMonth: number;
  readonly expiryYear: number;
  /** Yalnizca bu dogrulamada kullanilir (D2); saklanmaz, gunluge YAZILMAZ. */
  readonly cvv: string;
}

/**
 * Dogrulama sonucu. APPROVED ve CHALLENGE_REQUIRED kart kaydedilir (3DS odeme
 * aninda sorulur); DECLINED kaydedilmez.
 */
export interface CardVerification {
  readonly decision: ProviderDecision;
  /**
   * Saglayicinin kart jetonu; kayitli kart onun karsiligidir (T12.4 odemeyi kart
   * kimligiyle yapar). Yalnizca APPROVED ve CHALLENGE_REQUIRED'da anlamli;
   * DECLINED'da bos olabilir.
   */
  readonly providerToken: string;
}

export interface CardVerifier {
  verifyCard(input: VerifyCardInput): Promise<CardVerification>;
}
