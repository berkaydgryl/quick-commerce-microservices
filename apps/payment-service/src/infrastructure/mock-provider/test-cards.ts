/**
 * Mock saglayicinin tanidigi test kartlari.
 *
 * Numaralar kart dunyasinin yaygin test numaralaridir (gercek kart degil).
 * Servise NUMARA DEGIL JETON gelir: istemcideki demo saglayici kart
 * numarasini bu jetonlardan birine cevirir (T12.4), numara sozlesmeden gecmez.
 * Jeton son dort haneyi tasir; hangi kartin kullanildigi gunlukte okunabilir,
 * tam numara hicbir yerde saklanmaz.
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
};
