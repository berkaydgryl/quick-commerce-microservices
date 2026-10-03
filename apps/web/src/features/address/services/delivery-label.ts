/**
 * Ust bardaki teslimat adresinin gorunen adi (T11.10 duzeltmesi): SAF kural.
 *
 * Hesabin adresi kendi adiyla gorunur ("Ev", "Annemler"). Varsayilan adresin
 * adi ise icerikten gelir: "Ev" turunun etiketi (icerik: addressSetup.kinds).
 * DEFAULT_ADDRESS_TITLE yalnizca ic kimliktir (seed'deki "Ev" ile eslesme);
 * ekrana kodda sabit metin olarak cikmaz.
 */

import type { AddressKindOption } from '@getir/contracts';

import type { DeliveryAddressState } from './delivery-address';

type ReadyDelivery = Extract<DeliveryAddressState, { status: 'ready' }>;

export function deliveryLabel(
  delivery: ReadyDelivery,
  kinds: readonly AddressKindOption[],
): string {
  if (delivery.source === 'account') {
    return delivery.title;
  }
  const home = kinds.find((option) => option.kind === 'HOME') ?? kinds[0];
  return home?.label ?? delivery.title;
}
