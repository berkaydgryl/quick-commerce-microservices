/**
 * Ust bardaki teslimat adresinin gorunen adi (T11.10 duzeltmesi, QA B3):
 * varsayilan adresin adi icerikten gelir, kodda sabit metin degil.
 */

import type { AddressKindOption } from '@getir/contracts';
import { describe, expect, it } from 'vitest';

import { deliveryLabel } from '../../src/features/address/services/delivery-label';

const KINDS: readonly AddressKindOption[] = [
  { kind: 'WORK', label: 'İşyeri', icon: '🏢' },
  { kind: 'HOME', label: 'Evim', icon: '🏠' },
];
const LOCATION = { lat: 40.98, lng: 29.02 };

describe('deliveryLabel', () => {
  it('hesabin adresi kendi adiyla', () => {
    const delivery = {
      status: 'ready',
      source: 'account',
      title: 'Annemler',
      location: LOCATION,
    } as const;
    expect(deliveryLabel(delivery, KINDS)).toBe('Annemler');
  });

  it('varsayilan adres icerikteki "Ev" turunun etiketiyle (kod sabiti degil)', () => {
    const delivery = {
      status: 'ready',
      source: 'default',
      reason: 'anonymous',
      title: 'Ev',
      location: LOCATION,
    } as const;
    expect(deliveryLabel(delivery, KINDS)).toBe('Evim');
  });

  it('icerikte "Ev" turu yoksa ilk tur etiketi', () => {
    const delivery = {
      status: 'ready',
      source: 'default',
      reason: 'no-addresses',
      title: 'Ev',
      location: LOCATION,
    } as const;
    expect(deliveryLabel(delivery, KINDS.slice(0, 1))).toBe('İşyeri');
  });
});
