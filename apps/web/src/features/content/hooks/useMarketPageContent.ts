import { CONTENT_FALLBACK } from '@getir/contracts';
import type { MarketPageContent } from '@getir/contracts';

import { useWelcomeContent } from './useWelcomeContent';

/**
 * Magaza sayfasinin metinleri (T16.2): icerik ucundan; uc hata verirse icerik
 * yedeginden (degerler welcome.json ile ayni, contracts testi denetler).
 * Icerik yuklenirken undefined.
 */
export function useMarketPageContent(): MarketPageContent | undefined {
  const { data, error } = useWelcomeContent();
  if (data !== undefined) {
    return data.marketPage;
  }
  return error === null ? undefined : CONTENT_FALLBACK.marketPage;
}
