import { CONTENT_FALLBACK } from '@getir/contracts';
import type { CheckoutContent } from '@getir/contracts';

import { useWelcomeContent } from './useWelcomeContent';

/**
 * Odeme sayfasinin metinleri (T17.1): icerik ucundan; uc hata verirse icerik
 * yedeginden (degerler welcome.json ile ayni, contracts testi denetler).
 * Icerik yuklenirken undefined.
 */
export function useCheckoutContent(): CheckoutContent | undefined {
  const { data, error } = useWelcomeContent();
  if (data !== undefined) {
    return data.checkout;
  }
  return error === null ? undefined : CONTENT_FALLBACK.checkout;
}
