import { CONTENT_FALLBACK } from '@getir/contracts';
import type { ProfileContent } from '@getir/contracts';

import { useWelcomeContent } from './useWelcomeContent';

/**
 * Profil kartinin ve e-posta penceresinin metinleri (T11.14): icerik ucundan;
 * uc hata verirse icerik yedeginden (degerler welcome.json ile ayni, contracts
 * testi denetler). E-posta icerik gelmese de dogrulanir. Yuklenirken undefined.
 */
export function useProfileContent(): ProfileContent | undefined {
  const { data, error } = useWelcomeContent();
  if (data !== undefined) {
    return data.profile;
  }
  return error === null ? undefined : CONTENT_FALLBACK.profile;
}
