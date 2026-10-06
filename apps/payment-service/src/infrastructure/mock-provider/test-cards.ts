/**
 * Mock saglayicinin tanidigi test kartlari.
 *
 * Numaralar kart dunyasinin yaygin test numaralaridir (gercek kart degil).
 * Cekime (Charge) NUMARA DEGIL JETON gelir; numara yalnizca kart kasasinin
 * eklemesinde (T11.17) mock'un 0 TL dogrulamasina gecer ve karsiligi olan
 * jeton saklanir. Jeton son dort haneyi tasir; hangi kartin kullanildigi
 * gunlukte okunabilir, tam numara hicbir yerde saklanmaz.
 */

import type { ProviderDecision } from '../../domain/payment-provider.js';

export interface TestCard {
  /** Istemciye gosterilen test numarasi (belge ve demo icin). */
  readonly number: string;
  readonly decision: ProviderDecision;
}

export const TEST_CARDS: Readonly<Record<string, TestCard>> = {
  tok_test_4242: { number: '4242 4242 4242 4242', decision: 'APPROVED' },
  tok_test_0002: { number: '4000 0000 0000 0002', decision: 'DECLINED' },
  tok_test_3184: { number: '4000 0027 6000 3184', decision: 'CHALLENGE_REQUIRED' },
  // Kart kasasinin markalari (T11.17): her markadan onaylanan bir kart.
  tok_test_4444: { number: '5555 5555 5555 4444', decision: 'APPROVED' },
  tok_test_0005: { number: '3782 822463 10005', decision: 'APPROVED' },
  tok_test_0003: { number: '9792 0000 0000 0003', decision: 'APPROVED' },
};
