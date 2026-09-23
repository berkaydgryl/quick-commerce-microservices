/**
 * Odeme saglayicisi portu (roadmap: PaymentProvider - bugun mock kart, yarin
 * gercek bir PSP sandbox'i). Domain yalnizca KARARI bilir; kartin nasil
 * yorumlandigi saglayicinin isidir.
 */

import type { Money } from './payment.js';

/**
 * Saglayicinin cekim karari.
 * - APPROVED: tutar cekildi.
 * - DECLINED: kart reddedildi.
 * - CHALLENGE_REQUIRED: banka 3DS dogrulamasi istiyor; tutar henuz cekilmedi.
 */
export type ProviderDecision = 'APPROVED' | 'DECLINED' | 'CHALLENGE_REQUIRED';

export interface AuthorizeInput {
  /** Saklanmis kart jetonu. Ham kart numarasi bu sinirdan GECMEZ. */
  readonly cardToken: string;
  readonly amount: Money;
}

export interface VerifyChallengeInput {
  readonly challengeId: string;
  /** Kullanicinin girdigi kod. Gunluge ve hata ayrintisina YAZILMAZ. */
  readonly code: string;
}

export interface PaymentProvider {
  authorize(input: AuthorizeInput): Promise<ProviderDecision>;
  /**
   * 3DS kodunu dogrular: true ise banka cekimi onayladi. Kodu domain degil
   * saglayici (banka) bilir; gercek bir PSP takildiginda da boyle olur.
   */
  verifyChallenge(input: VerifyChallengeInput): Promise<boolean>;
}
