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

export interface PaymentProvider {
  authorize(input: AuthorizeInput): Promise<ProviderDecision>;
}
