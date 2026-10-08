import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { useSessionStore } from '../../../shared/session/session-store';
import { useLoaderVisible } from '../../../shared/ui/app-loader/useLoaderVisible';
import { AppLoadingOverlay } from '../../content/ui/AppLoadingOverlay';
import { loginPathFor } from '../services/next-path';

/**
 * Korumali sayfa (T8.5): oturum yoksa giris ekranina, girisle bu sayfaya geri.
 * Acilistaki sessiz yenileme bitene kadar bekler (uzarsa Yukleniyor gostergesi,
 * F18; metin icerikten ya da yedekten); herkese acik sayfalar beklemez.
 * Gosterge acikken sayfa cizilmez ve giris yonlendirmesi en az sureyi bekler
 * (gosterge bir an parlayip kaybolmaz).
 */
export function RequireAuth({ children }: { readonly children: ReactNode }) {
  const status = useSessionStore((state) => state.status);
  const location = useLocation();
  const loading = useLoaderVisible(status === 'unknown');

  if (status === 'anonymous' && !loading) {
    return <Navigate to={loginPathFor(location)} replace />;
  }
  return (
    <>
      {status === 'authenticated' && !loading && children}
      <AppLoadingOverlay visible={loading} />
    </>
  );
}
