import { CONTENT_FALLBACK } from '@getir/contracts';
import type { FavoritesContent } from '@getir/contracts';

import { useWelcomeContent } from './useWelcomeContent';

/**
 * Favori marketlerin metinleri (T11.13): icerik ucundan; uc hata verirse
 * icerik yedeginden (degerler welcome.json ile ayni, contracts testi
 * denetler). Kalp icerik gelmese de calisir. Icerik yuklenirken undefined.
 */
export function useFavoritesContent(): FavoritesContent | undefined {
  const { data, error } = useWelcomeContent();
  if (data !== undefined) {
    return data.favorites;
  }
  return error === null ? undefined : CONTENT_FALLBACK.favorites;
}
