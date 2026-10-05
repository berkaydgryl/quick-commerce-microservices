import { CONTENT_FALLBACK } from '@getir/contracts';
import type { AccountMenuContent } from '@getir/contracts';

import { useWelcomeContent } from './useWelcomeContent';

/**
 * Hesap menusunun etiketleri (T11.16): sol menu ve ust barin Profil acilir
 * menusu AYNI kaynaktan okur. Uc hata verirse icerik yedegi (degerler
 * welcome.json ile ayni, contracts testi denetler); yuklenirken undefined.
 */
export function useAccountMenuContent(): AccountMenuContent | undefined {
  const { data, error } = useWelcomeContent();
  if (data !== undefined) {
    return data.accountMenu;
  }
  return error === null ? undefined : CONTENT_FALLBACK.accountMenu;
}
