import { CONTENT_FALLBACK } from '@getir/contracts';

import { useWelcomeContent } from './useWelcomeContent';

export interface AppLoadingTexts {
  readonly brand: string;
  readonly service: string;
  readonly label: string;
}

/**
 * Yukleniyor gostergesinin metinleri (F18): icerik geldiyse oradan, gelmediyse
 * (gosterge cogunlukla icerik beklenirken gorunur) icerik yedeginden. Hic
 * undefined donmez: gosterge metin beklemez.
 */
export function useAppLoadingTexts(): AppLoadingTexts {
  const { data } = useWelcomeContent();
  if (data !== undefined) {
    return { brand: data.header.brand, service: data.header.service, label: data.appLoading.label };
  }
  return {
    brand: CONTENT_FALLBACK.brand,
    service: CONTENT_FALLBACK.service,
    label: CONTENT_FALLBACK.appLoading.label,
  };
}
