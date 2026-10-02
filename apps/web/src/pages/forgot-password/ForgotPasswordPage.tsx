import { useState } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';

import { useCloseAuthDialog } from '../../features/auth/hooks/useCloseAuthDialog';
import { AUTH_ROUTES, NEXT_PARAM } from '../../features/auth/routes';
import { readAuthRouteState } from '../../features/auth/services/auth-route-state';
import type { PhoneEntry } from '../../features/auth/services/auth-route-state';
import { safeNextPath, withNextPath } from '../../features/auth/services/next-path';
import { AuthDialog } from '../../features/auth/ui/AuthDialog';
import { AuthSwitch } from '../../features/auth/ui/AuthSwitch';
import { ResetPasswordForm } from '../../features/auth/ui/ResetPasswordForm';
import { useSessionStore } from '../../shared/session/session-store';
import { WelcomePage } from '../welcome/WelcomePage';

/**
 * /sifremi-unuttum (T11.9; yalnizca gelistirme paketinde, router.tsx):
 * karsilama ekraninin ustunde pencere. Telefon ve yeni sifre; giris
 * penceresinden ya da karttan gelen numara dolu gelir. Yenileme oturumu acar
 * ve donus adresine gider ("/": adresi olmayan hesapta adres penceresi).
 */
export function ForgotPasswordPage() {
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
  const state = { phoneEntry: entry ?? undefined, fromApp };
  return (
    <WelcomePage
      renderDialog={(content) => (
        <AuthDialog
          title={content.loginCard.resetPassword.title}
          closeLabel={content.loginCard.closeLabel}
          onClose={close}
          footer={
            <AuthSwitch
              prompt={content.loginCard.resetPassword.loginPrompt}
              label={content.loginCard.resetPassword.loginLinkLabel}
              to={withNextPath(AUTH_ROUTES.login, next)}
              state={state}
            />
          }
        >
          <ResetPasswordForm
            content={content.loginCard}
            initialEntry={phoneEntry}
            onPhoneChange={setEntry}
            registerSwitch={{ to: withNextPath(AUTH_ROUTES.register, next), state }}
          />
        </AuthDialog>
      )}
    />
  );
}
