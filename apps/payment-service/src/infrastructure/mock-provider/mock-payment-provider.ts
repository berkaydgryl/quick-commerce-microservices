/**
 * Mock odeme saglayicisi: jetona gore karar verir, para hareketi yoktur.
 *
 * Taninmayan jeton REDDEDILIR: gercek saglayici da bilinmeyen jetonla cekim
 * yapmaz. Hata firlatmak yerine red donmek, kart reddinin "is sonucu" olarak
 * akmasini (FAILED + PAYMENT_DECLINED) korur.
 */

import type {
  AuthorizeInput,
  PaymentProvider,
  ProviderDecision,
} from '../../domain/payment-provider.js';
import { TEST_CARDS } from './test-cards.js';

export class MockPaymentProvider implements PaymentProvider {
  authorize({ cardToken }: AuthorizeInput): Promise<ProviderDecision> {
    return Promise.resolve(TEST_CARDS[cardToken]?.decision ?? 'DECLINED');
  }
}
