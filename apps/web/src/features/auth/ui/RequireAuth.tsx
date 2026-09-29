import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { useSessionStore } from '../../../shared/session/session-store';
import { QueryLoading } from '../../../shared/ui/query-status/QueryStatus';
import { loginPathFor } from '../services/next-path';

/**
 * Korumali sayfa (T8.5): oturum yoksa giris ekranina, girisle bu sayfaya geri.
 * Acilistaki sessiz yenileme bitene kadar bekler; herkese acik sayfalar beklemez.
 */
export function RequireAuth({ children }: { readonly children: ReactNode }) {
  const status = useSessionStore((state) => state.status);
  const location = useLocation();

  if (status === 'unknown') {
    return <QueryLoading>Oturumun kontrol ediliyor…</QueryLoading>;
  }
  if (status === 'anonymous') {
    return <Navigate to={loginPathFor(location)} replace />;
  }
  return children;
}
