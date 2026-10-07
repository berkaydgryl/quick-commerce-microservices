import { CONTENT_FALLBACK } from '@getir/contracts';
import type { AddressSetupContent, AppHeaderContent, WelcomeContent } from '@getir/contracts';

import { contentFailed, useWelcomeContent } from './useWelcomeContent';

export interface AppHeaderTexts {
  readonly appHeader: AppHeaderContent;
  /** Adres penceresi (harita, arama, form). */
  readonly addressSetup: AddressSetupContent;
  /** Pencerenin "Kapat"i (loginCard.closeLabel). */
  readonly closeLabel: string;
}

const FALLBACK: AppHeaderTexts = {
  appHeader: CONTENT_FALLBACK.appHeader,
  addressSetup: CONTENT_FALLBACK.addressSetup,
  closeLabel: CONTENT_FALLBACK.closeLabel,
};

/**
 * Ust bar ve adres penceresinin metinleri (F21; 07.10 hatasi): icerik
 * ucundan; uc hata verirse ya da gateway ile web arasindaki surum farki
 * yuzunden sema gecmezse icerik yedeginden (degerler welcome.json ile ayni,
 * contracts testi denetler). Bar ve adres penceresi hicbir zaman hata
 * gostermez. Ilk yuklemede undefined; bir kez hata olduysa yeniden istek
 * surerken de yedek kalir (bar ve acik adres penceresi bozulmaz).
 */
export function useAppHeaderContent(): AppHeaderTexts | undefined {
  return appHeaderTexts(useWelcomeContent());
}

/** Saf secim (birim testi sorgu durumlariyla sinar). */
export function appHeaderTexts(query: {
  readonly data: WelcomeContent | undefined;
  readonly errorUpdatedAt: number;
}): AppHeaderTexts | undefined {
  const { data } = query;
  if (data !== undefined) {
    return {
      appHeader: data.appHeader,
      addressSetup: data.addressSetup,
      closeLabel: data.loginCard.closeLabel,
    };
  }
  return contentFailed(query) ? FALLBACK : undefined;
}
