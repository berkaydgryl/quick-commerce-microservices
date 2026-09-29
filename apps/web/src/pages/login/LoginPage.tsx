import { Navigate, useSearchParams } from 'react-router-dom';

import { DemoPersonaPicker } from '../../features/auth/demo/DemoPersonaPicker';
import { AUTH_ROUTES, NEXT_PARAM } from '../../features/auth/routes';
import { safeNextPath, withNextPath } from '../../features/auth/services/next-path';
import { AuthCard } from '../../features/auth/ui/AuthCard';
import { LoginForm } from '../../features/auth/ui/LoginForm';
import type { LoginCredentials } from '../../features/auth/ui/LoginForm';
import { useSessionStore } from '../../shared/session/session-store';
import { PageLayout } from '../../shared/ui/page-layout/PageLayout';

/**
 * Persona secici yalnizca gelistirme paketinde (vite.config.ts): kosul derleme
 * aninda "false" olunca secici ve persona verisi pakete hic girmez.
 */
const renderPersonaPicker = __DEMO_PERSONAS__
  ? (fill: (credentials: LoginCredentials) => void) => <DemoPersonaPicker onPick={fill} />
  : undefined;

/**
 * /giris (T8.5). Oturum acilinca (ya da zaten aciksa) donus adresine gidilir;
 * adres yalnizca uygulama icindeki bir yol olabilir (next-path.ts).
 */
export function LoginPage() {
  const status = useSessionStore((state) => state.status);
  const [searchParams] = useSearchParams();
  const next = safeNextPath(searchParams.get(NEXT_PARAM));

  if (status === 'authenticated') {
    return <Navigate to={next} replace />;
  }
  return (
    <PageLayout>
      <AuthCard>
        <LoginForm
          registerPath={withNextPath(AUTH_ROUTES.register, next)}
          renderPrefill={renderPersonaPicker}
        />
      </AuthCard>
    </PageLayout>
  );
}
