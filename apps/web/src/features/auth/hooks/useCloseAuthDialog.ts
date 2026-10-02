import { useNavigate } from 'react-router-dom';

import { AUTH_ROUTES } from '../routes';

/**
 * Giris/kayit penceresini kapatma (T11.6). Pencere uygulama icinden acildiysa
 * bir geri gidilir: geri tusuyla ayni sonuc, pencereyi acan ekran yerinde
 * kalir. Adres dogrudan acildiysa (yer imi, korumali sayfanin yonlendirmesi)
 * geri gidilecek bir uygulama ekrani yoktur: karsilama ekranina gidilir.
 * Korumali sayfaya donulmez; donulseydi yeniden girise yonlendirirdi.
 */
export function useCloseAuthDialog(fromApp: boolean): () => void {
  const navigate = useNavigate();
  return () => {
    if (fromApp) {
      navigate(-1);
    } else {
      navigate(AUTH_ROUTES.welcome, { replace: true });
    }
  };
}
