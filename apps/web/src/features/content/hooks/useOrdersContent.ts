import { CONTENT_FALLBACK } from '@getir/contracts';
import type { OrdersContent } from '@getir/contracts';

import { useWelcomeContent } from './useWelcomeContent';

/**
 * Gecmis Siparislerim'in metinleri (T11.16): icerik ucundan; uc hata verirse
 * icerik yedeginden (degerler welcome.json ile ayni, contracts testi
 * denetler). Icerik yuklenirken undefined.
 */
export function useOrdersContent(): OrdersContent | undefined {
  const { data, error } = useWelcomeContent();
  if (data !== undefined) {
    return data.orders;
  }
  return error === null ? undefined : CONTENT_FALLBACK.orders;
}
