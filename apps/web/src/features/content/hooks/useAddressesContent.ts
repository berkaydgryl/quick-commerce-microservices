import { CONTENT_FALLBACK } from '@getir/contracts';
import type { AddressesContent } from '@getir/contracts';

import { useWelcomeContent } from './useWelcomeContent';

/**
 * Adreslerim sekmesinin metinleri (T11.15): icerik ucundan; uc hata verirse
 * icerik yedeginden (degerler welcome.json ile ayni, contracts testi
 * denetler). Icerik yuklenirken undefined.
 */
export function useAddressesContent(): AddressesContent | undefined {
  const { data, error } = useWelcomeContent();
  if (data !== undefined) {
    return data.addresses;
  }
  return error === null ? undefined : CONTENT_FALLBACK.addresses;
}
