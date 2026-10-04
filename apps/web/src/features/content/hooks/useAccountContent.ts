import { CONTENT_FALLBACK } from '@getir/contracts';

import { useWelcomeContent } from './useWelcomeContent';

/** Hesabim panelinin baslik ve cikis metinleri (ust barin Profil menusuyle ayni). */
export interface AccountContent {
  readonly title: string;
  readonly logoutLabel: string;
  readonly logoutPendingLabel: string;
}

/**
 * Hesabim paneli (T11.14'te ekrana gomulu metinden icerige tasindi): ust barin
 * metinleri; icerik gelmezse yedek (cikis icerik olmadan da calismali).
 * Yuklenirken undefined.
 */
export function useAccountContent(): AccountContent | undefined {
  const { data, error } = useWelcomeContent();
  const texts = data?.appHeader ?? (error === null ? undefined : CONTENT_FALLBACK);
  return texts === undefined
    ? undefined
    : {
        title: texts.accountLabel,
        logoutLabel: texts.logoutLabel,
        logoutPendingLabel: texts.logoutPendingLabel,
      };
}
