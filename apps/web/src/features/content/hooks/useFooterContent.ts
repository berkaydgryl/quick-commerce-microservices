import { CONTENT_FALLBACK } from '@getir/contracts';
import type { FooterContent } from '@getir/contracts';

import { useWelcomeContent } from './useWelcomeContent';

/**
 * Sayfa alt bilgisinin metni (T16.3; sepet ve odeme): icerik ucundan; uc
 * hata verirse icerik yedeginden (degerler welcome.json ile ayni, contracts
 * testi denetler). Icerik yuklenirken undefined.
 */
export function useFooterContent(): FooterContent | undefined {
  const { data, error } = useWelcomeContent();
  if (data !== undefined) {
    return data.footer;
  }
  return error === null ? undefined : CONTENT_FALLBACK.footer;
}
