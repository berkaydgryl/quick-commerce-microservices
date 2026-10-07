import { CONTENT_FALLBACK } from '@getir/contracts';
import type { CartPageContent } from '@getir/contracts';

import { useWelcomeContent } from './useWelcomeContent';

/**
 * Sepet sayfasinin metinleri (T16.3): icerik ucundan; uc hata verirse icerik
 * yedeginden (degerler welcome.json ile ayni, contracts testi denetler).
 * Icerik yuklenirken undefined.
 */
export function useCartPageContent(): CartPageContent | undefined {
  const { data, error } = useWelcomeContent();
  if (data !== undefined) {
    return data.cartPage;
  }
  return error === null ? undefined : CONTENT_FALLBACK.cartPage;
}
