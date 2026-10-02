import { useState } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';

import { useCloseAuthDialog } from '../../features/auth/hooks/useCloseAuthDialog';
import { AUTH_ROUTES, NEXT_PARAM } from '../../features/auth/routes';
import { readAuthRouteState } from '../../features/auth/services/auth-route-state';
import type { PhoneEntry } from '../../features/auth/services/auth-route-state';
import { safeNextPath, withNextPath } from '../../features/auth/services/next-path';
import { AuthDialog } from '../../features/auth/ui/AuthDialog';
import { AuthSwitch } from '../../features/auth/ui/AuthSwitch';
import { RegisterForm } from '../../features/auth/ui/RegisterForm';
import { useSessionStore } from '../../shared/session/session-store';
import { WelcomePage } from '../welcome/WelcomePage';

/**
 * /kayit (T8.5; T11.6'dan beri karsilama ekraninin ustunde pencere): ad soyad,
 * telefon, sifre; giris penceresinden gelen numara dolu gelir. Kayit oturumu
 * acar ve donus adresine gider.
 */
export function RegisterPage() {
  const status = useSessionStore((state) => state.status);
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const next = safeNextPath(searchParams.get(NEXT_PARAM));
  const { phoneEntry, fromApp } = readAuthRouteState(location.state);
  const [entry, setEntry] = useState<PhoneEntry | null>(phoneEntry);
  const close = useCloseAuthDialog(fromApp);

  if (status === 'authenticated') {
    return <Navigate to={next} replace />;
  }
  // Alt bant ve kayitli numara uyarisi ayni yere, numarayla gider.
  const loginSwitch = {
    to: withNextPath(AUTH_ROUTES.login, next),
    state: { phoneEntry: entry ?? undefined, fromApp },
  };
  return (
    <WelcomePage
      renderDialog={(content) => (
        <AuthDialog
          title={content.header.registerLabel}
          closeLabel={content.loginCard.closeLabel}
          onClose={close}
          footer={
            <AuthSwitch
              prompt={content.loginCard.register.loginPrompt}
              label={content.loginCard.register.loginLinkLabel}
              to={loginSwitch.to}
              state={loginSwitch.state}
            />
          }
        >
          <RegisterForm
            content={content.loginCard}
            initialEntry={phoneEntry}
            onPhoneChange={setEntry}
            loginSwitch={loginSwitch}
          />
        </AuthDialog>
      )}
    />
  );
}
