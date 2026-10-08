import { useEffect } from 'react';
import { createPortal } from 'react-dom';

import { AppLoader } from '../../../shared/ui/app-loader/AppLoader';
import { useAppLoadingTexts } from '../hooks/useAppLoadingTexts';

let openCount = 0;

/** Gosterge acikken uygulama koku etkisiz (inert): klavye ve ekran okuyucu alttaki sayfaya gecmez. */
function useInertRoot(visible: boolean) {
  useEffect(() => {
    const root = document.getElementById('root');
    if (!visible || root === null) return undefined;
    openCount += 1;
    root.inert = true;
    return () => {
      openCount -= 1;
      if (openCount === 0) root.inert = false;
    };
  }, [visible]);
}

/**
 * Tam ekran bekleyisin gostergesi (F18; PM S1 a): icerik kapisi, oturum
 * kontrolu ve "/" kapisi kullanir; baska bekleyis de cagirabilir ("Sipariş
 * Ver" kullanici kararinda). Ne zaman gorunecegi cagiranda: useLoaderVisible
 * (300 ms'den kisa bekleyiste gorunmez; gorunduyse en az 600 ms kalir).
 * Gosterge acikken cagiran alttaki sayfayi cizmez; gosterge body'ye cizilir
 * ve uygulama koku inert olur (odak alta kacmaz).
 */
export function AppLoadingOverlay({ visible }: { readonly visible: boolean }) {
  const texts = useAppLoadingTexts();
  useInertRoot(visible);
  return visible ? createPortal(<AppLoader {...texts} />, document.body) : null;
}
