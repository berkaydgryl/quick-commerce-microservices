import { CONTENT_FALLBACK } from '@getir/contracts';

import { useFavoritesContent } from '../features/content/hooks/useFavoritesContent';
import { Toaster } from '../shared/ui/toast/Toaster';

/**
 * Uygulamanin tek bildirim alani (T11.13). Kapatma dugmesinin adi icerikten;
 * icerik gelmeden de bildirim cikabilir: o arada yedek ad kullanilir.
 */
export function AppToaster() {
  const texts = useFavoritesContent();
  return (
    <Toaster
      dismissLabel={texts?.toastDismissLabel ?? CONTENT_FALLBACK.favorites.toastDismissLabel}
    />
  );
}
