import type { GeoPoint } from '@getir/contracts';

import type { DeliveryAddressState } from './delivery-address';
import { isSamePoint } from './geo-point';

/**
 * Kayit gecerli teslimat adresini KENDILIGINDEN tasiyor mu (F16): tasiyorsa
 * adres degisiminin bekcisi kayittan ONCE sorulur ("Hayır"da kayit yok).
 * Gecerli adres cozulmus adrestir (resolveDeliveryAddress): secim yoksa ya da
 * eskiyse ust barda defterin ilk adresi gorunur, o da sayilir.
 */

/** Duzenlenen adres gecerli adresse ve pini degistiyse (PM S2 a); ad, bina, not sormaz. */
export function editMovesDelivery(input: {
  readonly delivery: DeliveryAddressState;
  readonly editedId: string;
  readonly before: GeoPoint;
  readonly after: GeoPoint;
}): boolean {
  const { delivery } = input;
  return (
    delivery.status === 'ready' &&
    delivery.source === 'account' &&
    delivery.addressId === input.editedId &&
    !isSamePoint(input.before, input.after)
  );
}

/**
 * Gecerli adres varsayilansa (defter bos ya da okunamadi) eklenen adres
 * kayitla birlikte gecerli olur: "Hayır" eski adresi koruyamaz, soru once.
 * Defterde gecerli adres varsa ekleme kayittan SONRA sorar ("Hayır"da secilmez).
 */
export function addMovesDelivery(delivery: DeliveryAddressState): boolean {
  return delivery.status === 'ready' && delivery.source === 'default';
}
