import type { GeoPoint } from '@getir/contracts';

import { useAddressBook } from './useAddressBook';

/**
 * Gecerli teslimat konumu (T9.5). Oturum ve adres defteri cozulene kadar
 * undefined: konuma bagli sorgu (yakindaki marketler, genel arama) bekler,
 * once varsayilan konuma gidip sonra degismez.
 */
export function useDeliveryLocation(): GeoPoint | undefined {
  const { delivery } = useAddressBook();
  return delivery.status === 'ready' ? delivery.location : undefined;
}
