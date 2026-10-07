import { CONTENT_FALLBACK } from '@getir/contracts';
import type { ConfirmContent } from '@getir/contracts';

import { useWelcomeContent } from './useWelcomeContent';

/**
 * Ortak onay penceresinin dugmeleri (F13): "Evet" ve "Hayır". Icerik ucundan;
 * gelmediyse ya da yuklenirken yedekten (iki kisa etiket; pencere icerik
 * yuklendikten cok sonra acilir). Hic undefined donmez: pencere beklemez.
 */
export function useConfirmContent(): ConfirmContent {
  const { data } = useWelcomeContent();
  return data?.confirm ?? CONTENT_FALLBACK.confirm;
}
