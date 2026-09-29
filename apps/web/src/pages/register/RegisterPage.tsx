import { Navigate, useSearchParams } from 'react-router-dom';

import { AUTH_ROUTES, NEXT_PARAM } from '../../features/auth/routes';
import { safeNextPath, withNextPath } from '../../features/auth/services/next-path';
import { AuthCard } from '../../features/auth/ui/AuthCard';
import { RegisterForm } from '../../features/auth/ui/RegisterForm';
import { useSessionStore } from '../../shared/session/session-store';
import { PageLayout } from '../../shared/ui/page-layout/PageLayout';

/** /kayit (T8.5): giris ekraniyla ayni duzen; kayit oturumu acar ve donus adresine gider. */
export function RegisterPage() {
  const status = useSessionStore((state) => state.status);
  const [searchParams] = useSearchParams();
  const next = safeNextPath(searchParams.get(NEXT_PARAM));

  if (status === 'authenticated') {
    return <Navigate to={next} replace />;
  }
  return (
    <PageLayout>
      <AuthCard>
        <RegisterForm loginPath={withNextPath(AUTH_ROUTES.login, next)} />
      </AuthCard>
    </PageLayout>
  );
}
