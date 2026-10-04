import { CONTENT_FALLBACK } from '@getir/contracts';
import type { MarketListContent } from '@getir/contracts';

import { useWelcomeContent } from './useWelcomeContent';

/**
 * Market listesinin metinleri (T11.12): icerik ucundan; uc hata verirse
 * icerik yedeginden (@getir/contracts CONTENT_FALLBACK; degerler welcome.json
 * ile ayni, contracts testi denetler). Liste icerik gelmese de calisir. Icerik
 * yuklenirken undefined.
 */
export function useMarketListContent(): MarketListContent | undefined {
  const { data, error } = useWelcomeContent();
  if (data !== undefined) {
    return data.marketList;
  }
  return error === null ? undefined : CONTENT_FALLBACK.marketList;
}
